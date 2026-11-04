import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { anyApi, type ApiFromModules } from "convex/server";
import type * as attendance from "../../convex/attendance";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { rosterDigest, sha256 } from "../../convex/rosters";

const api = anyApi as unknown as ApiFromModules<{
  attendance: typeof attendance;
}>;
const a = api.attendance;
// Vite is transitive under pnpm; type only the macro used here without adding a dependency.
const modules = (
  import.meta as ImportMeta & {
    glob(pattern: string): Record<string, () => Promise<unknown>>;
  }
).glob("../../convex/**/*.ts");
const legacyId = "a".repeat(32),
  nextId = "b".repeat(32),
  foreignId = "c".repeat(32);
const page = { numItems: 50, cursor: null };

async function fixture(csv = "name,id\nAlice Smith,A1\nBob Jones,B2") {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const data = await t.run(async (ctx) => {
    const runId = await ctx.db.insert("migrationRuns", {
      fingerprint: "test-fingerprint",
      status: "active",
      exportedAt: "2026-01-01T00:00:00.000Z",
      expectedCounts: {
        accounts: 0,
        legacyClaims: 0,
        classes: 0,
        rosterVersions: 0,
        rosterMembers: 0,
        memberships: 0,
        sessions: 0,
        closures: 0,
        attendance: 0,
      },
    });
    const stateId = await ctx.db.insert("deploymentState", {
      key: "migration",
      activeRunId: runId,
      readsEnabled: true,
      writesEnabled: true,
    });
    const ownerId = await ctx.db.insert("users", {
      username: "owner",
      ownerKey: "workspace",
    });
    const teacherId = await ctx.db.insert("users", {
      username: "teacher",
      ownerKey: "other",
    });
    const outsiderId = await ctx.db.insert("users", {
      username: "outsider",
      ownerKey: "workspace",
    });
    await ctx.db.insert("ownerLinks", {
      userId: ownerId,
      ownerKey: "workspace",
    });
    const expirationTime = Date.now() + 60 * 60 * 1000;
    const ownerSession = await ctx.db.insert("authSessions", {
      userId: ownerId,
      expirationTime,
    });
    const teacherSession = await ctx.db.insert("authSessions", {
      userId: teacherId,
      expirationTime,
    });
    const outsiderSession = await ctx.db.insert("authSessions", {
      userId: outsiderId,
      expirationTime,
    });
    return {
      ownerId,
      teacherId,
      outsiderId,
      ownerSession,
      teacherSession,
      outsiderSession,
      expirationTime,
      runId,
      stateId,
    };
  });
  const owner = t.withIdentity({
    subject: `${data.ownerId}|${data.ownerSession}`,
  });
  const teacher = t.withIdentity({
    subject: `${data.teacherId}|${data.teacherSession}`,
  });
  const outsider = t.withIdentity({
    subject: `${data.outsiderId}|${data.outsiderSession}`,
  });
  const created = await owner.mutation(a.create, {
    newId: legacyId,
    title: "Science",
    csv,
  });
  const classId: Id<"classes"> = created.classId;
  return { t, owner, teacher, outsider, classId, ...data };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

describe("fresh attendance export", () => {
  it("exports the historical roster and current sparse facts without writes", async () => {
    const f = await fixture();
    const roster = await f.owner.query(a.roster, { legacyId });
    await f.t.mutation(anyApi.attendance.publicCheckin, {
      legacyId,
      identity: "A1",
    });
    await f.owner.mutation(a.excuse, {
      legacyId,
      studentId: roster[1].id,
      excused: true,
    });
    const details = await f.owner.query(a.classDetails, { classId: f.classId });
    await f.owner.mutation(a.saveRoster, {
      classId: f.classId,
      revision: details.revision,
      students: roster.map((s) => ({ ...s, name: `New ${s.name}` })),
    });
    const before = await snapshot(f);
    const result = await f.owner.query(a.exportSnapshot, { legacyId });
    expect(result.title).toBe("Science");
    expect(result.rows).toEqual([
      {
        name: "Alice Smith",
        code: "A1",
        checkedInAt: expect.any(String),
        excused: false,
      },
      { name: "Bob Jones", code: "B2", checkedInAt: null, excused: true },
    ]);
    expect(await snapshot(f)).toEqual(before);
  });

  it("rechecks class permission and maintenance state on each export", async () => {
    const f = await fixture();
    await expect(
      f.teacher.query(a.exportSnapshot, { legacyId }),
    ).rejects.toThrow("access");
    await f.owner.mutation(a.share, {
      classId: f.classId,
      username: "teacher",
    });
    expect(
      (await f.teacher.query(a.exportSnapshot, { legacyId })).rows,
    ).toHaveLength(2);
    await f.owner.mutation(a.unshare, {
      classId: f.classId,
      username: "teacher",
    });
    await expect(
      f.teacher.query(a.exportSnapshot, { legacyId }),
    ).rejects.toThrow("access");
    await f.t.run((ctx) => ctx.db.patch(f.stateId, { writesEnabled: false }));
    expect(
      (await f.owner.query(a.exportSnapshot, { legacyId })).rows,
    ).toHaveLength(2);
    await f.t.run((ctx) => ctx.db.patch(f.stateId, { readsEnabled: false }));
    await expect(f.owner.query(a.exportSnapshot, { legacyId })).rejects.toThrow(
      "unavailable",
    );
  });

  it("includes later attendance buckets and fails closed on inconsistent facts", async () => {
    const f = await fixture(
      "name,id\n" +
        Array.from({ length: 101 }, (_, i) => `Student ${i},ID${i}`).join("\n"),
    );
    await f.t.mutation(anyApi.attendance.publicCheckin, {
      legacyId,
      identity: "ID100",
    });
    const exported = await f.owner.query(a.exportSnapshot, { legacyId });
    expect(exported.rows).toHaveLength(101);
    expect(exported.rows[100]).toMatchObject({
      name: "Student 100",
      checkedInAt: expect.any(String),
    });
    await f.t.run(async (ctx) => {
      const fact = await ctx.db.query("attendance").unique();
      await ctx.db.patch(fact!._id, { bucket: 0 });
    });
    await expect(f.owner.query(a.exportSnapshot, { legacyId })).rejects.toThrow(
      "Invalid attendance facts",
    );
  });
});

describe("administrator maintenance boundary", () => {
  it("freezes writes without dropping reads or attendance, and resumes the same dataset", async () => {
    const f = await fixture(),
      fingerprint = "e".repeat(64);
    await f.t.run((ctx) => ctx.db.patch(f.runId, { fingerprint }));
    const before = await snapshot(f);
    await f.t.mutation(anyApi.operations.setAvailability, {
      fingerprint,
      readsEnabled: true,
      writesEnabled: false,
    });
    await expect(f.owner.mutation(a.close, { legacyId })).rejects.toThrow(
      "unavailable",
    );
    expect(await f.owner.query(a.roster, { legacyId })).toHaveLength(2);
    expect(await snapshot(f)).toEqual(before);
    await f.t.mutation(anyApi.operations.setAvailability, {
      fingerprint,
      readsEnabled: false,
      writesEnabled: false,
    });
    await expect(f.owner.query(a.roster, { legacyId })).rejects.toThrow(
      "unavailable",
    );
    await f.t.mutation(anyApi.operations.setAvailability, {
      fingerprint,
      readsEnabled: true,
      writesEnabled: true,
    });
    await f.owner.mutation(a.close, { legacyId });
    expect((await f.owner.query(a.session, { legacyId })).closed).toBe(true);
  });

  it("cannot activate an import or change an unexpected dataset", async () => {
    const f = await fixture(),
      fingerprint = "e".repeat(64);
    await f.t.run((ctx) => ctx.db.patch(f.runId, { fingerprint }));
    const original = await f.t.run((ctx) => ctx.db.get(f.stateId));
    for (const args of [
      { fingerprint: "f".repeat(64), readsEnabled: true, writesEnabled: true },
      { fingerprint, readsEnabled: false, writesEnabled: true },
    ])
      await expect(
        f.t.mutation(anyApi.operations.setAvailability, args),
      ).rejects.toThrow();
    await f.t.run((ctx) => ctx.db.patch(f.runId, { status: "verified" }));
    await expect(
      f.t.mutation(anyApi.operations.setAvailability, {
        fingerprint,
        readsEnabled: true,
        writesEnabled: true,
      }),
    ).rejects.toThrow();
    expect(await f.t.run((ctx) => ctx.db.get(f.stateId))).toEqual(original);
  });
});

async function snapshot(f: Fixture) {
  return f.t.run(async (ctx) => ({
    classes: await ctx.db.query("classes").collect(),
    states: await ctx.db.query("classState").collect(),
    versions: await ctx.db.query("rosterVersions").collect(),
    members: await ctx.db.query("rosterMembers").collect(),
    sessions: await ctx.db.query("sessions").collect(),
    memberships: await ctx.db.query("memberships").collect(),
    attendance: await ctx.db.query("attendance").collect(),
    closures: await ctx.db.query("closures").collect(),
  }));
}

describe("attendance access and deployment gates", () => {
  it("requires a live auth session belonging to an existing, non-anonymous user", async () => {
    const f = await fixture();
    await expect(f.t.query(a.viewer, {})).rejects.toThrow("Sign in");
    await expect(
      f.t.withIdentity({ subject: f.ownerId }).query(a.viewer, {}),
    ).rejects.toThrow("Sign in");
    await expect(
      f.t
        .withIdentity({ subject: `${f.ownerId}|${f.teacherSession}` })
        .query(a.viewer, {}),
    ).rejects.toThrow("expired");
    expect(await f.owner.query(a.viewer, {})).toEqual({
      username: "owner",
      ownerKey: "workspace",
      expiresAt: f.expirationTime,
    });
    await f.t.run(async (ctx) =>
      ctx.db.patch(f.ownerSession, { expirationTime: Date.now() - 1 }),
    );
    await expect(f.owner.query(a.session, { legacyId })).rejects.toThrow(
      "expired",
    );
    await f.t.run(async (ctx) =>
      ctx.db.patch(f.ownerSession, { expirationTime: NaN }),
    );
    await expect(f.owner.query(a.session, { legacyId })).rejects.toThrow(
      "expired",
    );
    await f.t.run(async (ctx) => ctx.db.delete(f.teacherSession));
    await expect(f.teacher.query(a.viewer, {})).rejects.toThrow("expired");
    await f.t.run(async (ctx) =>
      ctx.db.patch(f.outsiderId, { isAnonymous: true }),
    );
    await expect(f.outsider.query(a.viewer, {})).rejects.toThrow("Sign in");
  });

  it("rejects operations after auth session and user deletion", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => ctx.db.delete(f.ownerSession));
    await expect(f.owner.query(a.roster, { legacyId })).rejects.toThrow(
      "expired",
    );
    await expect(f.owner.mutation(a.close, { legacyId })).rejects.toThrow(
      "expired",
    );
    await f.t.run(async (ctx) => ctx.db.delete(f.teacherId));
    await expect(f.teacher.query(a.viewer, {})).rejects.toThrow("Sign in");
  });

  it("never grants ownership from users.ownerKey or an owner directory edge", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) =>
      ctx.db.insert("memberships", {
        classId: f.classId,
        userId: f.outsiderId,
        role: "owner",
      }),
    );
    expect(
      (await f.outsider.query(a.classes, { paginationOpts: page })).page,
    ).toEqual([]);
    expect((await f.outsider.query(a.viewer, {})).ownerKey).toBeNull();
    for (const fn of [a.session, a.roster])
      await expect(f.outsider.query(fn, { legacyId })).rejects.toThrow(
        "access",
      );
    await expect(
      f.outsider.query(a.bucket, { legacyId, bucket: 0 }),
    ).rejects.toThrow("access");
    await expect(f.outsider.mutation(a.close, { legacyId })).rejects.toThrow(
      "access",
    );
    await f.t.run(async (ctx) => {
      const link = await ctx.db
        .query("ownerLinks")
        .withIndex("by_owner", (q) => q.eq("ownerKey", "workspace"))
        .unique();
      await ctx.db.delete(link!._id);
    });
    await expect(f.owner.query(a.session, { legacyId })).rejects.toThrow(
      "access",
    );
    expect(
      (await f.owner.query(a.classes, { paginationOpts: page })).page,
    ).toEqual([]);
  });

  it("gates queries and mutations on consistent deployment state without fallback", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) =>
      ctx.db.patch(f.stateId, { writesEnabled: false }),
    );
    expect(await f.t.query(a.publicInfo, { legacyId })).toEqual({
      title: "Science",
      closed: false,
    });
    await expect(f.owner.mutation(a.close, { legacyId })).rejects.toThrow(
      "unavailable",
    );
    await expect(
      f.t.mutation(a.publicCheckin, { legacyId, identity: "A1" }),
    ).rejects.toThrow("unavailable");
    await f.t.run(async (ctx) =>
      ctx.db.patch(f.stateId, { readsEnabled: false, writesEnabled: true }),
    );
    await expect(f.owner.query(a.session, { legacyId })).rejects.toThrow(
      "unavailable",
    );
    await expect(f.owner.mutation(a.close, { legacyId })).rejects.toThrow(
      "unavailable",
    );
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.stateId, { readsEnabled: true });
      await ctx.db.patch(f.runId, { status: "verified" });
    });
    await expect(f.t.query(a.publicInfo, { legacyId })).rejects.toThrow(
      "unavailable",
    );
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.runId, { status: "active" });
      await ctx.db.insert("deploymentState", {
        key: "migration",
        readsEnabled: true,
        writesEnabled: true,
        activeRunId: f.runId,
      });
    });
    await expect(f.owner.query(a.viewer, {})).rejects.toThrow();
    await expect(
      f.t.mutation(a.publicCheckin, { legacyId, identity: "A1" }),
    ).rejects.toThrow();
    await f.t.run(async (ctx) => {
      for (const row of await ctx.db.query("deploymentState").collect())
        await ctx.db.delete(row._id);
    });
    await expect(f.owner.query(a.viewer, {})).rejects.toThrow("unavailable");
  });
});

describe("bounded queries and privacy", () => {
  it("returns exact public and authenticated shapes, with no private bucket fields", async () => {
    const f = await fixture();
    expect(await f.t.query(a.publicInfo, { legacyId })).toEqual({
      title: "Science",
      closed: false,
    });
    const session = await f.owner.query(a.session, { legacyId });
    expect(session).toEqual({
      id: legacyId,
      classId: legacyId,
      convexClassId: f.classId,
      title: "Science",
      createdAt: expect.any(String),
      count: 2,
      bucketSize: 100,
      bucketCount: 1,
      closed: false,
    });
    expect(await f.owner.query(a.roster, { legacyId })).toEqual([
      { id: "1", name: "Alice Smith", code: "A1" },
      { id: "2", name: "Bob Jones", code: "B2" },
    ]);
    expect(await f.owner.query(a.bucket, { legacyId, bucket: 0 })).toEqual([]);
    expect(
      await f.t.mutation(a.publicCheckin, { legacyId, identity: " a1 " }),
    ).toEqual({ name: "Alice Smith" });
    await f.owner.mutation(a.excuse, {
      legacyId,
      studentId: "1",
      excused: true,
    });
    expect(await f.owner.query(a.bucket, { legacyId, bucket: 0 })).toEqual([
      {
        studentId: "1",
        checkedInAt: expect.any(String),
        excusedAt: expect.any(String),
      },
    ]);
    expect(
      (await f.owner.query(a.classes, { paginationOpts: page })).page,
    ).toEqual([
      {
        id: legacyId,
        classId: f.classId,
        title: "Science",
        count: 2,
        isOwner: true,
      },
    ]);
    expect(
      (
        await f.owner.query(a.history, {
          classId: f.classId,
          paginationOpts: page,
        })
      ).page,
    ).toEqual([
      {
        id: legacyId,
        classId: legacyId,
        title: "Science",
        count: 2,
        createdAt: expect.any(String),
      },
    ]);
  });

  it("rejects invalid IDs and bucket bounds; uses immutable session bucket policy", async () => {
    const f = await fixture(
      "name,id\n" +
        Array.from({ length: 101 }, (_, i) => `Student ${i},code${i}`).join(
          "\n",
        ),
    );
    for (const bucket of [-1, 0.5, 2, 1e9])
      await expect(
        f.owner.query(a.bucket, { legacyId, bucket }),
      ).rejects.toThrow("bucket");
    for (const id of ["", "a", "z".repeat(32)])
      await expect(f.t.query(a.publicInfo, { legacyId: id })).rejects.toThrow(
        "ID",
      );
    await f.t.mutation(a.publicCheckin, { legacyId, identity: "code100" });
    expect(await f.owner.query(a.bucket, { legacyId, bucket: 0 })).toEqual([]);
    expect(await f.owner.query(a.bucket, { legacyId, bucket: 1 })).toEqual([
      { studentId: "101", checkedInAt: expect.any(String) },
    ]);
    await f.t.run(async (ctx) => {
      const state = await ctx.db
        .query("classState")
        .withIndex("by_class", (q) => q.eq("classId", f.classId))
        .unique();
      await ctx.db.delete(state!._id);
    });
    // Attendance reads and authorization never depend on the mutable class roster pointer.
    expect((await f.owner.query(a.roster, { legacyId })).length).toBe(101);
    expect(
      (await f.owner.query(a.bucket, { legacyId, bucket: 1 })).length,
    ).toBe(1);
    await f.owner.mutation(a.close, { legacyId });
  });

  it("isolates foreign classes, including a reused student ID and shared teacher", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) =>
      ctx.db.insert("ownerLinks", { userId: f.teacherId, ownerKey: "other" }),
    );
    await f.teacher.mutation(a.create, {
      newId: foreignId,
      title: "Foreign",
      csv: "name,id\nForeign Person,Z9",
    });
    await f.t.mutation(a.publicCheckin, {
      legacyId: foreignId,
      identity: "Z9",
    });
    await expect(
      f.owner.query(a.bucket, { legacyId: foreignId, bucket: 0 }),
    ).rejects.toThrow("access");
    await f.owner.mutation(a.share, {
      classId: f.classId,
      username: "teacher",
    });
    expect(await f.teacher.query(a.bucket, { legacyId, bucket: 0 })).toEqual(
      [],
    );
    await expect(
      f.owner.mutation(a.excuse, {
        legacyId,
        studentId: "foreign-only",
        excused: true,
      }),
    ).rejects.toThrow("roster");
    await f.t.run(async (ctx) => {
      const foreign = await ctx.db
        .query("sessions")
        .withIndex("by_legacy", (q) => q.eq("legacyId", foreignId))
        .unique();
      const original = await ctx.db
        .query("sessions")
        .withIndex("by_legacy", (q) => q.eq("legacyId", legacyId))
        .unique();
      await ctx.db.patch(original!._id, {
        rosterVersionId: foreign!.rosterVersionId,
      });
    });
    await expect(f.owner.query(a.roster, { legacyId })).rejects.toThrow(
      "roster",
    );
    await expect(
      f.t.mutation(a.publicCheckin, { legacyId, identity: "Z9" }),
    ).rejects.toThrow("roster");
    await expect(
      f.owner.mutation(a.excuse, { legacyId, studentId: "1", excused: true }),
    ).rejects.toThrow("roster");
  });

  it("paginates directory and history without scanning all history; caps page sizes", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const original = await ctx.db
        .query("sessions")
        .withIndex("by_legacy", (q) => q.eq("legacyId", legacyId))
        .unique();
      for (let i = 0; i < 55; i++) {
        const id = (i + 1).toString(16).padStart(32, "0");
        const classId = await ctx.db.insert("classes", {
          legacyId: id,
          ownerKey: "workspace",
          title: `Class ${i}`,
          createdAt: original!.createdAt,
        });
        const versionId = await ctx.db.insert("rosterVersions", {
          classId,
          sourceKey: id,
          digest: id,
          count: 1,
        });
        await ctx.db.insert("classState", {
          classId,
          rosterVersionId: versionId,
          revision: 0,
        });
        await ctx.db.insert("memberships", {
          classId,
          userId: f.ownerId,
          role: "owner",
        });
        await ctx.db.insert("sessions", {
          classId: f.classId,
          legacyId: id,
          title: original!.title,
          count: original!.count,
          rosterVersionId: original!.rosterVersionId,
          bucketSize: 100,
          createdAt: `2026-02-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        });
      }
    });
    for (const size of [0, 51, 100000, 1.5]) {
      await expect(
        f.owner.query(a.classes, {
          paginationOpts: { numItems: size, cursor: null },
        }),
      ).rejects.toThrow();
      await expect(
        f.owner.query(a.history, {
          classId: f.classId,
          paginationOpts: { numItems: size, cursor: null },
        }),
      ).rejects.toThrow();
    }
    const first = await f.owner.query(a.classes, { paginationOpts: page });
    expect(first.page).toHaveLength(50);
    expect(first.isDone).toBe(false);
    const second = await f.owner.query(a.classes, {
      paginationOpts: { numItems: 50, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(6);
    expect(second.isDone).toBe(true);
    const firstHistory = await f.owner.query(a.history, {
      classId: f.classId,
      paginationOpts: page,
    });
    const nextHistory = await f.owner.query(a.history, {
      classId: f.classId,
      paginationOpts: { numItems: 50, cursor: firstHistory.continueCursor },
    });
    expect(firstHistory.page).toHaveLength(50);
    expect(nextHistory.page).toHaveLength(6);
    const times = [...firstHistory.page, ...nextHistory.page].map(
      (s) => s.createdAt,
    );
    expect(times).toEqual([...times].sort().reverse());
  });
});

describe("sharing, editing, and immutable history", () => {
  it("grants teacher rights, reserves sharing for owners, and revokes immediately", async () => {
    const f = await fixture();
    await expect(f.teacher.query(a.session, { legacyId })).rejects.toThrow(
      "access",
    );
    await f.owner.mutation(a.share, {
      classId: f.classId,
      username: " TEACHER ",
    });
    expect(
      (await f.teacher.query(a.classes, { paginationOpts: page })).page[0]
        .isOwner,
    ).toBe(false);
    const details = await f.teacher.query(a.classDetails, {
      classId: f.classId,
    });
    expect(details.teachers).toEqual([{ username: "teacher" }]);
    await expect(
      f.teacher.mutation(a.share, { classId: f.classId, username: "outsider" }),
    ).rejects.toThrow("Only the owner");
    await expect(
      f.teacher.mutation(a.unshare, { classId: f.classId, username: "owner" }),
    ).rejects.toThrow("Only the owner");
    await expect(
      f.owner.mutation(a.unshare, { classId: f.classId, username: "owner" }),
    ).rejects.toThrow("owner");
    await f.teacher.mutation(a.saveRoster, {
      classId: f.classId,
      revision: details.revision,
      students: [{ ...details.students[0], name: "Alice Updated" }],
    });
    await f.teacher.mutation(a.repeat, { legacyId, newId: nextId });
    await f.teacher.mutation(a.excuse, {
      legacyId: nextId,
      studentId: "1",
      excused: true,
    });
    await f.teacher.mutation(a.close, { legacyId: nextId });
    await f.owner.mutation(a.unshare, {
      classId: f.classId,
      username: "teacher",
    });
    await expect(
      f.teacher.query(a.bucket, { legacyId, bucket: 0 }),
    ).rejects.toThrow("access");
    await expect(
      f.teacher.mutation(a.excuse, {
        legacyId,
        studentId: "1",
        excused: false,
      }),
    ).rejects.toThrow("access");
    expect(
      (await f.teacher.query(a.classes, { paginationOpts: page })).page,
    ).toEqual([]);
  });

  it("caps additional teachers at 50, with repeated share/unshare as write-free no-ops", async () => {
    const f = await fixture();
    await f.owner.mutation(a.unshare, {
      classId: f.classId,
      username: "teacher",
    });
    await f.owner.mutation(a.share, {
      classId: f.classId,
      username: "teacher",
    });
    const before = await snapshot(f);
    await f.owner.mutation(a.share, {
      classId: f.classId,
      username: "teacher",
    });
    expect(await snapshot(f)).toEqual(before);
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 49; i++) {
        const userId = await ctx.db.insert("users", {
          username: `teacher${i}`,
        });
        await ctx.db.insert("memberships", {
          classId: f.classId,
          userId,
          role: "teacher",
        });
      }
    });
    await expect(
      f.owner.mutation(a.share, { classId: f.classId, username: "outsider" }),
    ).rejects.toThrow("50");
    expect(
      (await f.owner.query(a.classDetails, { classId: f.classId })).teachers,
    ).toHaveLength(50);
    await f.owner.mutation(a.unshare, {
      classId: f.classId,
      username: "teacher",
    });
    const removed = await snapshot(f);
    await f.owner.mutation(a.unshare, {
      classId: f.classId,
      username: "teacher",
    });
    expect(await snapshot(f)).toEqual(removed);
  });

  it("preserves old sessions, repeats the current roster, rejects stale edits, and reuses versions", async () => {
    const f = await fixture();
    const old = await f.owner.query(a.classDetails, { classId: f.classId });
    const changed = [
      { ...old.students[0], name: "Alice Renamed" },
      { id: "d".repeat(32), name: "New Student", code: "NEW" },
    ];
    await f.owner.mutation(a.saveRoster, {
      classId: f.classId,
      revision: old.revision,
      students: changed,
    });
    await expect(
      f.owner.mutation(a.saveRoster, {
        classId: f.classId,
        revision: old.revision,
        students: old.students,
      }),
    ).rejects.toThrow("Reload");
    const beforeRepeat = await snapshot(f);
    await f.owner.mutation(a.repeat, { legacyId, newId: nextId });
    const afterRepeat = await snapshot(f);
    expect({ ...afterRepeat, sessions: [] }).toEqual({
      ...beforeRepeat,
      sessions: [],
    });
    expect(afterRepeat.sessions).toHaveLength(beforeRepeat.sessions.length + 1);
    expect(await f.owner.query(a.roster, { legacyId })).toEqual(old.students);
    expect(await f.owner.query(a.roster, { legacyId: nextId })).toEqual(
      changed,
    );
    await expect(
      f.t.mutation(a.publicCheckin, { legacyId, identity: "NEW" }),
    ).rejects.toThrow("No unique match");
    await expect(
      f.owner.mutation(a.excuse, {
        legacyId,
        studentId: "d".repeat(32),
        excused: true,
      }),
    ).rejects.toThrow("roster");
    expect(
      await f.t.mutation(a.publicCheckin, {
        legacyId: nextId,
        identity: "NEW",
      }),
    ).toEqual({ name: "New Student" });
    // Restoration uses stable legacy IDs that still exist in the current version.
    const restore = [old.students[0]];
    await f.owner.mutation(a.saveRoster, {
      classId: f.classId,
      revision: old.revision + 1,
      students: restore,
    });
    await f.owner.mutation(a.saveRoster, {
      classId: f.classId,
      revision: old.revision + 2,
      students: changed,
    });
    const afterRestore = await snapshot(f);
    expect(afterRestore.versions).toHaveLength(3);
    expect(afterRestore.states[0].rosterVersionId).toBe(
      beforeRepeat.states[0].rosterVersionId,
    );
  });

  it("preserves IDs and order, enforces editor duplicate semantics, and writes nothing for identical content", async () => {
    const f = await fixture();
    const details = await f.owner.query(a.classDetails, { classId: f.classId });
    const before = await snapshot(f);
    await f.owner.mutation(a.saveRoster, {
      classId: f.classId,
      revision: details.revision,
      students: details.students.map((s) => ({ ...s, name: ` ${s.name} ` })),
    });
    expect(await snapshot(f)).toEqual(before);
    const invalid = [
      [],
      [{ id: "new", name: "New", code: "" }],
      [{ ...details.students[0], name: " " }],
      [{ ...details.students[0], code: "x".repeat(161) }],
      [details.students[0], details.students[0]],
      [
        { ...details.students[0], name: "Same", code: "" },
        { ...details.students[1], name: " same ", code: "B" },
      ],
      [
        { ...details.students[0], code: "duplicate" },
        { ...details.students[1], code: " DUPLICATE " },
      ],
      Array.from({ length: 1001 }, (_, i) => ({
        id: i.toString(16).padStart(32, "0"),
        name: `S${i}`,
        code: "",
      })),
    ];
    for (const students of invalid)
      await expect(
        f.owner.mutation(a.saveRoster, {
          classId: f.classId,
          revision: details.revision,
          students,
        }),
      ).rejects.toThrow();
    expect(await snapshot(f)).toEqual(before);
    const students = [
      { ...details.students[1], name: "Same", code: "B" },
      { ...details.students[0], name: " same ", code: "A" },
    ];
    await f.owner.mutation(a.saveRoster, {
      classId: f.classId,
      revision: details.revision,
      students,
    });
    expect(
      (await f.owner.query(a.classDetails, { classId: f.classId })).students,
    ).toEqual(students.map((s) => ({ ...s, name: s.name.trim() })));
  });

  it("rejects duplicate client session IDs atomically and invalid create payloads", async () => {
    const f = await fixture();
    const before = await snapshot(f);
    await expect(
      f.owner.mutation(a.create, {
        newId: legacyId,
        title: "Duplicate",
        csv: "New",
      }),
    ).rejects.toThrow("exists");
    await expect(
      f.owner.mutation(a.repeat, { legacyId, newId: legacyId }),
    ).rejects.toThrow("exists");
    await expect(
      f.owner.mutation(a.create, { newId: nextId, title: " ", csv: "New" }),
    ).rejects.toThrow("title");
    await expect(
      f.owner.mutation(a.create, {
        newId: nextId,
        title: "New",
        csv: "name\n",
      }),
    ).rejects.toThrow();
    await expect(
      f.owner.mutation(a.create, {
        newId: nextId,
        title: "New",
        csv: "name\nSame\nsame",
      }),
    ).rejects.toThrow("Duplicate");
    expect(await snapshot(f)).toEqual(before);
  });
});

describe("public matching and sparse attendance", () => {
  it("uses a unique normalized code first, then a unique name; handles legacy ambiguity", async () => {
    const f = await fixture(
      "name,id\nAlice Smith,NAME\nName,OTHER\nSame,A\nSame,B\nUnique,C",
    );
    expect(
      await f.t.mutation(a.publicCheckin, { legacyId, identity: " NAME " }),
    ).toEqual({ name: "Alice Smith" });
    expect(
      await f.t.mutation(a.publicCheckin, {
        legacyId,
        identity: " alice   SMITH ",
      }),
    ).toEqual({ name: "Alice Smith", already: true });
    await expect(
      f.t.mutation(a.publicCheckin, { legacyId, identity: "same" }),
    ).rejects.toThrow("No unique match");
    for (const identity of ["", " ", "X".repeat(161), "not present"]) {
      await expect(
        f.t.mutation(a.publicCheckin, { legacyId, identity }),
      ).rejects.toThrow();
    }
    // Imported historical rosters may contain duplicate codes, so preserve fallback semantics.
    await f.t.run(async (ctx) => {
      const session = await ctx.db
        .query("sessions")
        .withIndex("by_legacy", (q) => q.eq("legacyId", legacyId))
        .unique();
      for (const id of ["3", "4"]) {
        const row = await ctx.db
          .query("rosterMembers")
          .withIndex("by_version_student", (q) =>
            q.eq("versionId", session!.rosterVersionId).eq("studentId", id),
          )
          .unique();
        await ctx.db.patch(row!._id, {
          code: "unique",
          normalizedCode: "unique",
        });
      }
    });
    expect(
      await f.t.mutation(a.publicCheckin, { legacyId, identity: "unique" }),
    ).toEqual({ name: "Unique" });
    expect(
      (await f.owner.query(a.bucket, { legacyId, bucket: 0 })).map(
        (row) => row.studentId,
      ),
    ).toEqual(["1", "5"]);
  });

  it("preserves the first check-in and excuse timestamps; same-value actions write nothing", async () => {
    const f = await fixture();
    await f.owner.mutation(a.excuse, {
      legacyId,
      studentId: "1",
      excused: true,
    });
    const excused = await snapshot(f);
    await f.owner.mutation(a.excuse, {
      legacyId,
      studentId: "1",
      excused: true,
    });
    expect(await snapshot(f)).toEqual(excused);
    await f.t.mutation(a.publicCheckin, { legacyId, identity: "A1" });
    const checked = await snapshot(f);
    expect(checked.attendance[0].excusedAt).toBe(
      excused.attendance[0].excusedAt,
    );
    expect(
      await f.t.mutation(a.publicCheckin, {
        legacyId,
        identity: "Alice Smith",
      }),
    ).toEqual({ name: "Alice Smith", already: true });
    expect(await snapshot(f)).toEqual(checked);
    await f.owner.mutation(a.excuse, {
      legacyId,
      studentId: "1",
      excused: false,
    });
    const cleared = await snapshot(f);
    expect(cleared.attendance[0].checkedInAt).toBe(
      checked.attendance[0].checkedInAt,
    );
    expect(cleared.attendance[0].excusedAt).toBeUndefined();
    await f.owner.mutation(a.excuse, {
      legacyId,
      studentId: "1",
      excused: false,
    });
    expect(await snapshot(f)).toEqual(cleared);
    // Never create per-student absence rows.
    expect(cleared.attendance).toHaveLength(1);
  });

  it("undoes excuses after close and deletes facts that have no remaining attendance", async () => {
    const f = await fixture();
    await f.owner.mutation(a.excuse, {
      legacyId,
      studentId: "1",
      excused: true,
    });
    await f.owner.mutation(a.close, { legacyId });
    const closed = await snapshot(f);
    await f.owner.mutation(a.close, { legacyId });
    expect(await snapshot(f)).toEqual(closed);
    expect(await f.t.query(a.publicInfo, { legacyId })).toEqual({
      title: "Science",
      closed: true,
    });
    await expect(
      f.t.mutation(a.publicCheckin, { legacyId, identity: "A1" }),
    ).rejects.toThrow("closed");
    await f.owner.mutation(a.excuse, {
      legacyId,
      studentId: "1",
      excused: false,
    });
    expect(await f.owner.query(a.bucket, { legacyId, bucket: 0 })).toEqual([]);
    expect((await snapshot(f)).attendance).toEqual([]);
    await f.owner.mutation(a.excuse, {
      legacyId,
      studentId: "2",
      excused: true,
    });
    expect(
      (await f.owner.query(a.bucket, { legacyId, bucket: 0 }))[0].studentId,
    ).toBe("2");
  });

  it("deduplicates concurrent check-ins and serializes check-in against close", async () => {
    const f = await fixture();
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.t.mutation(a.publicCheckin, { legacyId, identity: "A1" }),
      ),
    );
    expect(results.filter((r) => r.already)).toHaveLength(7);
    expect((await snapshot(f)).attendance).toHaveLength(1);
    const race = await Promise.allSettled([
      f.owner.mutation(a.close, { legacyId }),
      f.t.mutation(a.publicCheckin, { legacyId, identity: "B2" }),
    ]);
    expect(race[0].status).toBe("fulfilled");
    const final = await snapshot(f);
    expect(final.closures).toHaveLength(1);
    expect(
      final.attendance.filter((row) => row.studentId === "2"),
    ).toHaveLength(race[1].status === "fulfilled" ? 1 : 0);
    await expect(
      f.t.mutation(a.publicCheckin, { legacyId, identity: "B2" }),
    ).rejects.toThrow("closed");
    expect(await snapshot(f)).toEqual(final);
  });
});

it("hashes ordered Unicode roster content with portable SHA-256", () => {
  for (const value of ["", "abc", "Alice 🧑🏽‍🎓\n张伟", "x".repeat(1000)]) {
    expect(sha256(value)).toBe(
      createHash("sha256").update(value).digest("hex"),
    );
  }
  const students = [
    { id: "1", name: "Alice", code: "A" },
    { id: "2", name: "Bob", code: "B" },
  ];
  expect(rosterDigest(students)).toBe(
    createHash("sha256").update(JSON.stringify(students)).digest("hex"),
  );
  expect(rosterDigest(students)).not.toBe(
    rosterDigest([...students].reverse()),
  );
});
