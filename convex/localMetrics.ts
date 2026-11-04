// Bounded diagnostic fixtures for the local-only resource measurement script.
// These internal endpoints never participate in request handling and create no
// metrics documents. CONVEX_SITE_URL is supplied by the local Convex runtime.
import { v } from "convex/values";
import type { TransactionMetrics } from "convex/server";
import { internalMutation, internalQuery } from "./_generated/server";
import * as attendance from "./attendance";
import { reserve } from "./authSupport";
import { requireReady } from "./access";
import { rosterDigest, sha256 } from "./rosters";

const sizesValidator = v.array(v.number());
const idsValidator = v.object({
  classes: v.array(v.string()),
  sessions: v.array(v.string()),
});
const MAX_STUDENTS = 1000;
const MAX_HISTORY = 50;
const MAX_CLEANUP_DELETES = 100;

function requireLocal() {
  let local = false;
  try {
    local = ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(process.env.CONVEX_SITE_URL!).hostname,
    );
  } catch {}
  if (!local) throw new Error("Local resource fixtures are unavailable.");
}

function localId(value: string) {
  if (!/^[a-f0-9]{32}$/.test(value))
    throw new Error("Invalid local fixture identifier.");
}

function metricCounts(metrics: Awaited<ReturnType<typeof getMetrics>>) {
  if (metrics === null) return null;
  return Object.fromEntries(
    Object.entries(metrics).map(([key, metric]) => [key, metric.used]),
  );
}

async function getMetrics(ctx: any): Promise<TransactionMetrics | null> {
  try {
    return await ctx.meta.getTransactionMetrics();
  } catch {
    return null;
  }
}

export const prepare = internalMutation({
  args: { runId: v.string(), sizes: sizesValidator, historyCount: v.number() },
  handler: async (ctx, { runId, sizes, historyCount }) => {
    requireLocal();
    localId(runId);
    if (
      sizes.length !== 2 ||
      sizes[0] !== 30 ||
      sizes[1] !== 1000 ||
      !Number.isInteger(historyCount) ||
      historyCount < 1 ||
      historyCount > MAX_HISTORY
    ) {
      throw new Error(
        "Fixtures must use exactly 30 and 1000 students and 1–50 history sessions.",
      );
    }
    await requireReady(ctx, true);
    const ownerKey = `local-metrics:${runId}`;
    const userId = await ctx.db.insert("users", {
      username: `metrics-${runId}`,
      ownerKey,
    });
    const authSessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 86400000,
    });
    await ctx.db.insert("ownerLinks", {
      ownerKey,
      userId,
      directoryComplete: true,
    });
    const nativeClasses: string[] = [];
    const createdAt = new Date().toISOString();
    const classes: string[] = [];
    const sessions: string[] = [];
    for (const size of sizes) {
      const classLegacyId = runId.slice(0, 30) + (size === 30 ? "30" : "31");
      const classId = await ctx.db.insert("classes", {
        legacyId: classLegacyId,
        ownerKey: `local-metrics:${runId}`,
        title: "Local metrics fixture",
        createdAt,
      });
      classes.push(classLegacyId);
      nativeClasses.push(classId);
      await ctx.db.insert("memberships", { classId, userId, role: "owner" });
      const students = Array.from({ length: size }, (_, ordinal) => ({
        studentId: `${runId.slice(0, 20)}-${size}-${String(ordinal).padStart(4, "0")}`,
        name: `Fixture Student ${ordinal + 1}`,
        code: `LM${size}${String(ordinal).padStart(4, "0")}`,
        normalizedName: `fixture student ${ordinal + 1}`,
        normalizedCode: `lm${size}${String(ordinal).padStart(4, "0")}`,
        ordinal,
      }));
      const digest = rosterDigest(
        students.map((s) => ({ id: s.studentId, name: s.name, code: s.code })),
      );
      const versionId = await ctx.db.insert("rosterVersions", {
        classId,
        digest,
        sourceKey: `local-metrics:${runId}:${size}`,
        count: size,
      });
      await ctx.db.insert("classState", {
        classId,
        rosterVersionId: versionId,
        revision: 1,
      });
      for (const student of students)
        await ctx.db.insert("rosterMembers", { versionId, ...student });
      const sessionCount = size === 30 ? historyCount : 1;
      for (let i = 0; i < sessionCount; i++) {
        const suffix = (size === 30 ? i : MAX_HISTORY + 1)
          .toString(16)
          .padStart(2, "0");
        const legacyId =
          runId.slice(0, 28) + suffix + (size === 30 ? "30" : "31");
        const sessionId = await ctx.db.insert("sessions", {
          legacyId,
          classId,
          rosterVersionId: versionId,
          title: "Local metrics fixture",
          createdAt: new Date(Date.now() + i).toISOString(),
          count: size,
          bucketSize: 100,
        });
        sessions.push(legacyId);
        if (i === 0) {
          // Populate the first bucket to model a reasonably dense attendance
          // page, leaving the two write-sample students untouched.
          const seeded = size === 30 ? size - 2 : 100;
          for (let ordinal = 0; ordinal < seeded; ordinal++) {
            await ctx.db.insert("attendance", {
              sessionId,
              bucket: Math.floor(ordinal / 100),
              studentId: students[ordinal].studentId,
              ...(ordinal === 0
                ? { checkedInAt: createdAt }
                : { excusedAt: createdAt, excusedBy: "local-metrics" }),
            });
          }
        }
      }
    }
    return {
      classes,
      sessions,
      nativeClasses,
      subject: `${userId}|${authSessionId}`,
    };
  },
});

// Invoke the installed application's registered handlers in the SAME context.
// This is local diagnostic use of the pinned SDK _handler interface, not another
// implementation of the attendance operations. Transport/JWT parsing is excluded.
export const readSample = internalQuery({
  args: {
    legacyId: v.string(),
    classId: v.id("classes"),
    mode: v.union(
      v.literal("exportSnapshot"),
      v.literal("viewer"),
      v.literal("classes"),
      v.literal("session"),
      v.literal("roster"),
      v.literal("bucket"),
      v.literal("history"),
    ),
    bucket: v.optional(v.number()),
  },
  handler: async (ctx, { legacyId, classId, mode, bucket }) => {
    requireLocal();
    localId(legacyId);
    const args =
      mode === "viewer"
        ? {}
        : mode === "classes"
          ? { paginationOpts: { numItems: 25, cursor: null } }
          : mode === "history"
            ? { classId, paginationOpts: { numItems: 25, cursor: null } }
            : mode === "bucket"
              ? { legacyId, bucket: bucket ?? 0 }
              : { legacyId };
    const result = await (attendance[mode] as any)._handler(ctx, args);
    return { result, db: metricCounts(await getMetrics(ctx)) };
  },
});

export const writeSample = internalMutation({
  args: {
    legacyId: v.string(),
    studentId: v.string(),
    identity: v.string(),
    kind: v.union(
      v.literal("checkinNew"),
      v.literal("checkinDuplicate"),
      v.literal("excuseNew"),
      v.literal("excuseDuplicate"),
    ),
  },
  handler: async (ctx, { legacyId, studentId, identity, kind }) => {
    requireLocal();
    localId(legacyId);
    const result = kind.startsWith("checkin")
      ? await (attendance.publicCheckin as any)._handler(ctx, {
          legacyId,
          identity,
        })
      : await (attendance.excuse as any)._handler(ctx, {
          legacyId,
          studentId,
          excused: true,
        });
    return { result, db: metricCounts(await getMetrics(ctx)) };
  },
});

export const admissionSample = internalMutation({
  args: { runId: v.string(), legacyId: v.string(), nonce: v.string() },
  handler: async (ctx, { runId, legacyId, nonce }) => {
    requireLocal();
    localId(runId);
    localId(legacyId);
    localId(nonce);
    let maintenanceDeletes = 0;
    const db = new Proxy(ctx.db, {
      get(target, property) {
        if (property === "delete")
          return async (id: any) => {
            maintenanceDeletes++;
            return target.delete(id);
          };
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await (reserve as any)._handler(
      { ...ctx, db },
      {
        nonce,
        issuedAt: Date.now(),
        ipHash: sha256(runId),
        username: sha256(runId + legacyId),
        operation: "checkin",
        sessionLegacyId: legacyId,
      },
    );
    return {
      result,
      maintenanceDeletes,
      db: metricCounts(await getMetrics(ctx)),
    };
  },
});

export const cleanupAdmission = internalMutation({
  args: {
    runId: v.string(),
    legacyId: v.string(),
    nonces: v.array(v.string()),
  },
  handler: async (ctx, { runId, legacyId, nonces }) => {
    requireLocal();
    localId(runId);
    localId(legacyId);
    if (nonces.length > 4) throw new Error("Invalid cleanup scope.");
    const ipHash = sha256(runId),
      username = sha256(runId + legacyId);
    for (const nonce of nonces) {
      localId(nonce);
      const row = await ctx.db
        .query("gatewayNonces")
        .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
        .unique();
      if (row) await ctx.db.delete(row._id);
    }
    for (const key of [
      `student-ip:${ipHash}`,
      `student-session:${ipHash}:${legacyId}`,
      `student:${ipHash}:${username}`,
    ]) {
      const rows = await ctx.db
        .query("throttleCounters")
        .withIndex("by_key_bucket", (q) => q.eq("key", key))
        .take(4);
      for (const row of rows) await ctx.db.delete(row._id);
    }
    // This fixture admits only two fresh nonces. Include their partitioned
    // broad counters while retaining a fixed cleanup bound and exact run scope.
    for (const prefix of [`student-ip:${ipHash}:p:`, `student-session:${ipHash}:${legacyId}:p:`]) {
      const rows = await ctx.db.query("throttleCounters").withIndex("by_key_bucket", q =>
        q.gte("key", prefix).lt("key", prefix + "\uffff")).take(20);
      for (const row of rows) await ctx.db.delete(row._id);
    }
  },
});

export const cleanupBatch = internalMutation({
  args: { ids: idsValidator },
  handler: async (ctx, { ids }) => {
    requireLocal();
    if (
      ids.classes.length !== 2 ||
      ids.sessions.length < 2 ||
      ids.sessions.length > MAX_HISTORY + 1 ||
      [...ids.classes, ...ids.sessions].some((id) => !/^[a-f0-9]{32}$/.test(id))
    )
      throw new Error("Invalid cleanup scope.");
    let deleted = 0;
    for (const legacyId of ids.sessions) {
      if (deleted >= MAX_CLEANUP_DELETES) break;
      const session = await ctx.db
        .query("sessions")
        .withIndex("by_legacy", (q) => q.eq("legacyId", legacyId))
        .unique();
      if (!session) continue;
      const sessionClass = await ctx.db.get(session.classId);
      if (
        !sessionClass ||
        !ids.classes.includes(sessionClass.legacyId) ||
        sessionClass.title !== "Local metrics fixture" ||
        !sessionClass.ownerKey.startsWith("local-metrics:")
      ) {
        throw new Error("Cleanup target is not a local metrics fixture.");
      }
      const attendance = await ctx.db
        .query("attendance")
        .withIndex("by_session_bucket_student", (q) =>
          q.eq("sessionId", session._id),
        )
        .take(MAX_CLEANUP_DELETES - deleted);
      for (const row of attendance) {
        await ctx.db.delete(row._id);
        deleted++;
      }
      if (attendance.length === 0 && deleted < MAX_CLEANUP_DELETES) {
        await ctx.db.delete(session._id);
        deleted++;
      }
    }
    for (const legacyId of ids.classes) {
      if (deleted >= MAX_CLEANUP_DELETES) break;
      const klass = await ctx.db
        .query("classes")
        .withIndex("by_legacy", (q) => q.eq("legacyId", legacyId))
        .unique();
      if (!klass) continue;
      if (
        klass.title !== "Local metrics fixture" ||
        !klass.ownerKey.startsWith("local-metrics:")
      ) {
        throw new Error("Cleanup target is not a local metrics fixture.");
      }
      const versions = await ctx.db
        .query("rosterVersions")
        .withIndex("by_class_digest", (q) => q.eq("classId", klass._id))
        .take(2);
      if (versions.length > 1)
        throw new Error("Cleanup found unexpected roster versions.");
      const version = versions[0];
      if (version) {
        if (!version.sourceKey.startsWith("local-metrics:"))
          throw new Error("Cleanup target is not a local metrics fixture.");
        const members = await ctx.db
          .query("rosterMembers")
          .withIndex("by_version_order", (q) => q.eq("versionId", version._id))
          .take(MAX_CLEANUP_DELETES - deleted);
        for (const row of members) {
          await ctx.db.delete(row._id);
          deleted++;
        }
        if (members.length === 0 && deleted < MAX_CLEANUP_DELETES) {
          await ctx.db.delete(version._id);
          deleted++;
        }
      }
      if (!version && deleted < MAX_CLEANUP_DELETES - 3) {
        const state = await ctx.db
          .query("classState")
          .withIndex("by_class", (q) => q.eq("classId", klass._id))
          .unique();
        if (state) {
          await ctx.db.delete(state._id);
          deleted++;
        }
        const members = await ctx.db
          .query("memberships")
          .withIndex("by_class_user", (q) => q.eq("classId", klass._id))
          .take(2);
        for (const member of members) {
          await ctx.db.delete(member._id);
          deleted++;
        }
        await ctx.db.delete(klass._id);
        deleted++;
      }
    }
    const remainingSessions = await Promise.all(
      ids.sessions.map((id) =>
        ctx.db
          .query("sessions")
          .withIndex("by_legacy", (q) => q.eq("legacyId", id))
          .unique(),
      ),
    );
    const remainingClasses = await Promise.all(
      ids.classes.map((id) =>
        ctx.db
          .query("classes")
          .withIndex("by_legacy", (q) => q.eq("legacyId", id))
          .unique(),
      ),
    );
    const done =
      remainingSessions.every((x) => !x) && remainingClasses.every((x) => !x);
    if (done) {
      const runPrefix = ids.classes[0].slice(0, 30);
      const actors = await ctx.db
        .query("users")
        .withIndex("by_username", (q) =>
          q
            .gte("username", `metrics-${runPrefix}`)
            .lt("username", `metrics-${runPrefix}g`),
        )
        .take(2);
      for (const user of actors) {
        if (!user.ownerKey?.startsWith("local-metrics:"))
          throw new Error("Invalid cleanup actor.");
        const sessions = await ctx.db
          .query("authSessions")
          .withIndex("userId", (q) => q.eq("userId", user._id))
          .take(2);
        for (const session of sessions) await ctx.db.delete(session._id);
        const links = await ctx.db
          .query("ownerLinks")
          .withIndex("by_user_owner", (q) => q.eq("userId", user._id))
          .take(2);
        for (const link of links) await ctx.db.delete(link._id);
        await ctx.db.delete(user._id);
      }
    }
    return { deleted, done };
  },
});
