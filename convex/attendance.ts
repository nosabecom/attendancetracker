import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { normalize, parseRoster } from "../lib/roster.mjs";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  fail,
  getByLegacySession,
  requireClassAccess,
  requireReady,
  requireViewer,
  validateLegacyId,
} from "./access";
import {
  currentVersion,
  readStudents,
  rosterDigest,
  storeVersion,
  validateStudents,
  versionForSession,
} from "./rosters";

const classArgs = { classId: v.id("classes") };
const sessionArgs = { legacyId: v.string() };
const BUCKET_SIZE = 100;

function pageSize(numItems: number) {
  if (!Number.isInteger(numItems) || numItems < 1 || numItems > 50)
    fail(400, "Request between 1 and 50 items.");
}

async function ownedWorkspace(ctx: QueryCtx, userId: Id<"users">) {
  const [link] = await ctx.db
    .query("ownerLinks")
    .withIndex("by_user_owner", (q) => q.eq("userId", userId))
    .take(1);
  if (!link) return null;
  const authoritative = await ctx.db
    .query("ownerLinks")
    .withIndex("by_owner", (q) => q.eq("ownerKey", link.ownerKey))
    .unique();
  return authoritative?.userId === userId ? link.ownerKey : null;
}

async function authorizedSession(ctx: QueryCtx, legacyId: string) {
  const viewer = await requireViewer(ctx);
  const session = await getByLegacySession(ctx, legacyId);
  const access = await requireClassAccess(ctx, session.classId, viewer);
  return { ...access, session };
}

async function isClosed(ctx: QueryCtx, sessionId: Id<"sessions">) {
  return (
    (await ctx.db
      .query("closures")
      .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
      .unique()) !== null
  );
}

async function attendanceFact(
  ctx: QueryCtx,
  sessionId: Id<"sessions">,
  bucket: number,
  studentId: string,
) {
  return ctx.db
    .query("attendance")
    .withIndex("by_session_bucket_student", (q) =>
      q
        .eq("sessionId", sessionId)
        .eq("bucket", bucket)
        .eq("studentId", studentId),
    )
    .unique();
}

function memberBucket(session: Doc<"sessions">, ordinal: number) {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= session.count)
    fail(503, "Invalid roster ordinal.");
  return Math.floor(ordinal / session.bucketSize);
}

async function requireUnusedId(ctx: QueryCtx, newId: string) {
  validateLegacyId(newId);
  const session = await ctx.db
    .query("sessions")
    .withIndex("by_legacy", (q) => q.eq("legacyId", newId))
    .unique();
  const klass = await ctx.db
    .query("classes")
    .withIndex("by_legacy", (q) => q.eq("legacyId", newId))
    .unique();
  if (session || klass) fail(409, "This attendance ID already exists.");
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    await requireReady(ctx);
    const { user, session } = await requireViewer(ctx);
    return {
      username: user.username ?? "",
      ownerKey: await ownedWorkspace(ctx, user._id),
      expiresAt: session.expirationTime,
    };
  },
});

export const classes = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    await requireReady(ctx);
    const viewer = await requireViewer(ctx);
    pageSize(paginationOpts.numItems);
    const result = await ctx.db
      .query("memberships")
      .withIndex("by_user_class", (q) => q.eq("userId", viewer.user._id))
      .paginate({ ...paginationOpts, maximumRowsRead: 50 });
    const page = [];
    for (const edge of result.page) {
      const klass = await ctx.db.get(edge.classId);
      if (!klass) continue;
      const owner = await ctx.db
        .query("ownerLinks")
        .withIndex("by_owner", (q) => q.eq("ownerKey", klass.ownerKey))
        .unique();
      const isOwner = owner?.userId === viewer.user._id;
      if (!isOwner && edge.role !== "teacher") continue;
      // Re-read the exact authorization edge, so a directory row is never an owner grant.
      const access = await requireClassAccess(ctx, klass._id, viewer);
      const { version } = await currentVersion(ctx, klass._id);
      page.push({
        id: klass.legacyId,
        classId: klass._id,
        title: klass.title,
        count: version.count,
        isOwner: access.isOwner,
      });
    }
    return { ...result, page };
  },
});

export const history = query({
  args: { ...classArgs, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { classId, paginationOpts }) => {
    await requireReady(ctx);
    const { klass } = await requireClassAccess(ctx, classId);
    pageSize(paginationOpts.numItems);
    const result = await ctx.db
      .query("sessions")
      .withIndex("by_class_created", (q) => q.eq("classId", classId))
      .order("desc")
      .paginate({ ...paginationOpts, maximumRowsRead: 50 });
    return {
      ...result,
      page: result.page.map(({ legacyId: id, title, createdAt, count }) => ({
        id,
        title,
        createdAt,
        count,
        classId: klass.legacyId,
      })),
    };
  },
});

export const session = query({
  args: sessionArgs,
  handler: async (ctx, { legacyId }) => {
    await requireReady(ctx);
    const { session, klass } = await authorizedSession(ctx, legacyId);
    return {
      id: session.legacyId,
      classId: klass.legacyId,
      convexClassId: klass._id,
      title: session.title,
      createdAt: session.createdAt,
      count: session.count,
      bucketSize: session.bucketSize,
      bucketCount: Math.ceil(session.count / session.bucketSize),
      closed: await isClosed(ctx, session._id),
    };
  },
});

export const roster = query({
  args: sessionArgs,
  handler: async (ctx, { legacyId }) => {
    await requireReady(ctx);
    const { session } = await authorizedSession(ctx, legacyId);
    return readStudents(ctx, await versionForSession(ctx, session));
  },
});

export const bucket = query({
  args: { ...sessionArgs, bucket: v.number() },
  handler: async (ctx, { legacyId, bucket }) => {
    await requireReady(ctx);
    const { session } = await authorizedSession(ctx, legacyId);
    if (
      !Number.isInteger(bucket) ||
      bucket < 0 ||
      bucket >= Math.ceil(session.count / session.bucketSize)
    ) {
      fail(400, "Invalid attendance bucket.");
    }
    const rows = await ctx.db
      .query("attendance")
      .withIndex("by_session_bucket_student", (q) =>
        q.eq("sessionId", session._id).eq("bucket", bucket),
      )
      .take(session.bucketSize + 1);
    if (rows.length > session.bucketSize)
      fail(503, "Invalid attendance bucket size.");
    return rows.map(({ studentId, checkedInAt, excusedAt }) => ({
      studentId,
      ...(checkedInAt !== undefined ? { checkedInAt } : {}),
      ...(excusedAt !== undefined ? { excusedAt } : {}),
    }));
  },
});

// Explicit exports read one authorized, consistent database snapshot. The live
// screen's cached buckets are never used as the source of a download.
export const exportSnapshot = query({
  args: sessionArgs,
  handler: async (ctx, { legacyId }) => {
    await requireReady(ctx);
    const { session } = await authorizedSession(ctx, legacyId);
    const students = await readStudents(
      ctx,
      await versionForSession(ctx, session),
    );
    const rows = await ctx.db
      .query("attendance")
      .withIndex("by_session_bucket_student", (q) =>
        q.eq("sessionId", session._id),
      )
      .take(session.count + 1);
    if (rows.length > session.count) fail(503, "Invalid attendance facts.");
    const ordinals = new Map(
      students.map((student, ordinal) => [student.id, ordinal]),
    );
    const facts = new Map<string, Doc<"attendance">>();
    for (const row of rows) {
      const ordinal = ordinals.get(row.studentId);
      if (
        ordinal === undefined ||
        facts.has(row.studentId) ||
        row.bucket !== memberBucket(session, ordinal)
      )
        fail(503, "Invalid attendance facts.");
      facts.set(row.studentId, row);
    }
    return {
      title: session.title,
      rows: students.map((student) => {
        const fact = facts.get(student.id);
        return {
          name: student.name,
          code: student.code,
          checkedInAt: fact?.checkedInAt ?? null,
          excused: fact?.excusedAt !== undefined,
        };
      }),
    };
  },
});

export const classDetails = query({
  args: classArgs,
  handler: async (ctx, { classId }) => {
    await requireReady(ctx);
    const { isOwner, klass } = await requireClassAccess(ctx, classId);
    const { state, version } = await currentVersion(ctx, classId);
    const edges = await ctx.db
      .query("memberships")
      .withIndex("by_class_user", (q) => q.eq("classId", classId))
      .take(52);
    if (edges.length > 51) fail(503, "Invalid teacher directory.");
    const teachers = [];
    for (const edge of edges) {
      if (edge.role !== "teacher") continue;
      const user = await ctx.db.get(edge.userId);
      if (user?.username) teachers.push({ username: user.username });
    }
    return {
      id: klass.legacyId,
      title: klass.title,
      revision: state.revision,
      students: await readStudents(ctx, version),
      isOwner,
      teachers,
    };
  },
});

export const create = mutation({
  args: { newId: v.string(), title: v.string(), csv: v.string() },
  handler: async (ctx, { newId, title, csv }) => {
    await requireReady(ctx, true);
    const { user } = await requireViewer(ctx);
    await requireUnusedId(ctx, newId);
    const ownerKey = await ownedWorkspace(ctx, user._id);
    if (!ownerKey)
      fail(403, "Claim or create a workspace before creating a class.");
    title = title.trim();
    if (!title || title.length > 100 || csv.length > 1_000_000)
      fail(400, "Invalid class title or CSV size.");
    let students;
    try {
      students = parseRoster(csv);
    } catch (error) {
      fail(400, error instanceof Error ? error.message : "Invalid CSV.");
    }
    const createdAt = new Date().toISOString();
    const classId = await ctx.db.insert("classes", {
      legacyId: newId,
      ownerKey,
      title,
      createdAt,
    });
    const versionId = await storeVersion(ctx, classId, students);
    await ctx.db.insert("classState", {
      classId,
      rosterVersionId: versionId,
      revision: 1,
    });
    await ctx.db.insert("memberships", {
      classId,
      userId: user._id,
      role: "owner",
    });
    await ctx.db.insert("sessions", {
      legacyId: newId,
      classId,
      rosterVersionId: versionId,
      title,
      createdAt,
      count: students.length,
      bucketSize: BUCKET_SIZE,
    });
    return { id: newId, classId };
  },
});

export const repeat = mutation({
  args: { ...sessionArgs, newId: v.string() },
  handler: async (ctx, { legacyId, newId }) => {
    await requireReady(ctx, true);
    const { klass } = await authorizedSession(ctx, legacyId);
    await requireUnusedId(ctx, newId);
    const { version } = await currentVersion(ctx, klass._id);
    await ctx.db.insert("sessions", {
      legacyId: newId,
      classId: klass._id,
      rosterVersionId: version._id,
      title: klass.title,
      createdAt: new Date().toISOString(),
      count: version.count,
      bucketSize: BUCKET_SIZE,
    });
    return { id: newId, classId: klass._id };
  },
});

export const saveRoster = mutation({
  args: {
    ...classArgs,
    revision: v.number(),
    students: v.array(
      v.object({ id: v.string(), name: v.string(), code: v.string() }),
    ),
  },
  handler: async (ctx, { classId, revision, students: input }) => {
    await requireReady(ctx, true);
    await requireClassAccess(ctx, classId);
    const { state, version } = await currentVersion(ctx, classId);
    if (!Number.isSafeInteger(revision) || revision !== state.revision)
      fail(409, "This roster changed. Reload before saving.");
    const current = await readStudents(ctx, version);
    const students = validateStudents(
      input,
      new Set(current.map((student) => student.id)),
    );
    // Compare content, including order, even when an imported version used a different digest convention.
    if (rosterDigest(current) === rosterDigest(students))
      return { revision: state.revision };
    if (state.revision === Number.MAX_SAFE_INTEGER)
      fail(503, "Class revision limit reached.");
    const versionId = await storeVersion(ctx, classId, students);
    await ctx.db.patch(state._id, {
      rosterVersionId: versionId,
      revision: state.revision + 1,
    });
    return { revision: state.revision + 1 };
  },
});

async function shareTarget(
  ctx: QueryCtx,
  classId: Id<"classes">,
  username: string,
) {
  const access = await requireClassAccess(ctx, classId);
  if (!access.isOwner) fail(403, "Only the owner can manage teachers.");
  username = normalize(username);
  if (!username || username.length > 160) fail(400, "Invalid username.");
  const target = await ctx.db
    .query("users")
    .withIndex("by_username", (q) => q.eq("username", username))
    .unique();
  if (!target) fail(404, "Teacher account not found.");
  if (target._id === access.user._id)
    fail(400, "The owner already has access to this class.");
  const edge = await ctx.db
    .query("memberships")
    .withIndex("by_class_user", (q) =>
      q.eq("classId", classId).eq("userId", target._id),
    )
    .unique();
  if (edge?.role === "owner")
    fail(400, "An owner directory entry cannot be changed here.");
  return { target, edge };
}

export const share = mutation({
  args: { ...classArgs, username: v.string() },
  handler: async (ctx, { classId, username }) => {
    await requireReady(ctx, true);
    const { target, edge } = await shareTarget(ctx, classId, username);
    if (edge) return { ok: true };
    const edges = await ctx.db
      .query("memberships")
      .withIndex("by_class_user", (q) => q.eq("classId", classId))
      .take(52);
    if (
      edges.length > 51 ||
      edges.filter((entry) => entry.role === "teacher").length >= 50
    ) {
      fail(400, "This class already has 50 additional teachers.");
    }
    await ctx.db.insert("memberships", {
      classId,
      userId: target._id,
      role: "teacher",
    });
    return { ok: true };
  },
});

export const unshare = mutation({
  args: { ...classArgs, username: v.string() },
  handler: async (ctx, { classId, username }) => {
    await requireReady(ctx, true);
    const { edge } = await shareTarget(ctx, classId, username);
    if (edge) await ctx.db.delete(edge._id);
    return { ok: true };
  },
});

export const excuse = mutation({
  args: { ...sessionArgs, studentId: v.string(), excused: v.boolean() },
  handler: async (ctx, { legacyId, studentId, excused }) => {
    await requireReady(ctx, true);
    const { session, user } = await authorizedSession(ctx, legacyId);
    if (!studentId || studentId.length > 160) fail(400, "Invalid student ID.");
    await versionForSession(ctx, session);
    const member = await ctx.db
      .query("rosterMembers")
      .withIndex("by_version_student", (q) =>
        q.eq("versionId", session.rosterVersionId).eq("studentId", studentId),
      )
      .unique();
    if (!member) fail(400, "This student is not on this session's roster.");
    const bucket = memberBucket(session, member.ordinal);
    const fact = await attendanceFact(ctx, session._id, bucket, studentId);
    if (Boolean(fact?.excusedAt) === excused) return { ok: true };
    if (excused) {
      const changes = {
        excusedAt: new Date().toISOString(),
        excusedBy: user._id as string,
      };
      if (fact) await ctx.db.patch(fact._id, changes);
      else
        await ctx.db.insert("attendance", {
          sessionId: session._id,
          bucket,
          studentId,
          ...changes,
        });
    } else if (fact) {
      if (fact.checkedInAt !== undefined)
        await ctx.db.patch(fact._id, {
          excusedAt: undefined,
          excusedBy: undefined,
        });
      else await ctx.db.delete(fact._id);
    }
    return { ok: true };
  },
});

export const close = mutation({
  args: sessionArgs,
  handler: async (ctx, { legacyId }) => {
    await requireReady(ctx, true);
    const { session } = await authorizedSession(ctx, legacyId);
    if (!(await isClosed(ctx, session._id)))
      await ctx.db.insert("closures", {
        sessionId: session._id,
        closedAt: new Date().toISOString(),
      });
    return { ok: true };
  },
});

// Only the admission gateway calls these; the public transport never returns roster data.
export const publicInfo = internalQuery({
  args: sessionArgs,
  handler: async (ctx, { legacyId }) => {
    await requireReady(ctx);
    const session = await getByLegacySession(ctx, legacyId);
    return { title: session.title, closed: await isClosed(ctx, session._id) };
  },
});

export const publicCheckin = internalMutation({
  args: { ...sessionArgs, identity: v.string() },
  handler: async (ctx, { legacyId, identity }) => {
    await requireReady(ctx, true);
    if (!identity.trim() || identity.length > 160)
      fail(400, "Enter your name or student ID.");
    const session = await getByLegacySession(ctx, legacyId);
    if (await isClosed(ctx, session._id))
      fail(409, "This attendance session is closed.");
    await versionForSession(ctx, session);
    const value = normalize(identity);
    const codes = await ctx.db
      .query("rosterMembers")
      .withIndex("by_version_code", (q) =>
        q.eq("versionId", session.rosterVersionId).eq("normalizedCode", value),
      )
      .take(2);
    let member = codes.length === 1 ? codes[0] : undefined;
    if (!member) {
      const names = await ctx.db
        .query("rosterMembers")
        .withIndex("by_version_name", (q) =>
          q
            .eq("versionId", session.rosterVersionId)
            .eq("normalizedName", value),
        )
        .take(2);
      if (names.length === 1) member = names[0];
    }
    if (!member)
      fail(
        400,
        "No unique match found. Use your student ID or ask your teacher to check the roster.",
      );
    const bucket = memberBucket(session, member.ordinal);
    const fact = await attendanceFact(
      ctx,
      session._id,
      bucket,
      member.studentId,
    );
    if (fact?.checkedInAt !== undefined)
      return { name: member.name, already: true };
    const checkedInAt = new Date().toISOString();
    if (fact) await ctx.db.patch(fact._id, { checkedInAt });
    else
      await ctx.db.insert("attendance", {
        sessionId: session._id,
        bucket,
        studentId: member.studentId,
        checkedInAt,
      });
    return { name: member.name };
  },
});
