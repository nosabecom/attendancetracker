import { getAuthSessionId, getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export function fail(status: number, message: string): never {
  throw new ConvexError({ status, message });
}

export function validateLegacyId(value: string) {
  if (!/^[a-f0-9]{32}$/.test(value)) fail(400, "Invalid attendance ID.");
}

export async function requireViewer(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || identity.subject.split("|").length !== 2) fail(401, "Sign in to continue.");
  const userId = await getAuthUserId(ctx);
  const sessionId = await getAuthSessionId(ctx);
  if (!userId || !sessionId || !ctx.db.normalizeId("users", userId) ||
      !ctx.db.normalizeId("authSessions", sessionId)) fail(401, "Sign in to continue.");
  const session = await ctx.db.get(sessionId);
  if (!session || session.userId !== userId || !Number.isFinite(session.expirationTime) || session.expirationTime <= Date.now()) {
    fail(401, "Your session has expired. Sign in again.");
  }
  const user = await ctx.db.get(userId);
  if (!user || user.isAnonymous) fail(401, "Sign in to continue.");
  return { user, session };
}

export type Viewer = Awaited<ReturnType<typeof requireViewer>>;

export async function requireReady(ctx: QueryCtx, write = false) {
  const state = await ctx.db.query("deploymentState")
    .withIndex("by_key", (q) => q.eq("key", "migration")).unique();
  if (!state || !state.activeRunId || !state.readsEnabled ||
      (write && !state.writesEnabled)) fail(503, "Attendance is temporarily unavailable.");
  const run = await ctx.db.get(state.activeRunId);
  if (!run || run.status !== "active") fail(503, "Attendance is temporarily unavailable.");
  const fingerprint = await ctx.db.query("migrationRuns")
    .withIndex("by_fingerprint", (q) => q.eq("fingerprint", run.fingerprint)).unique();
  if (fingerprint?._id !== run._id) fail(503, "Attendance is temporarily unavailable.");
  return state;
}

export async function requireClassAccess(ctx: QueryCtx, classId: Id<"classes">, viewer?: Viewer) {
  const { user, session } = viewer ?? await requireViewer(ctx);
  const klass = await ctx.db.get(classId);
  if (!klass) fail(404, "Class not found.");
  const owner = await ctx.db.query("ownerLinks")
    .withIndex("by_owner", (q) => q.eq("ownerKey", klass.ownerKey)).unique();
  const isOwner = owner?.userId === user._id;
  if (!isOwner) {
    const membership = await ctx.db.query("memberships")
      .withIndex("by_class_user", (q) => q.eq("classId", classId).eq("userId", user._id)).unique();
    if (membership?.role !== "teacher") fail(403, "You do not have access to this class.");
  }
  return { klass, isOwner, user, session };
}

export async function getByLegacySession(ctx: QueryCtx, legacyId: string) {
  validateLegacyId(legacyId);
  const session = await ctx.db.query("sessions")
    .withIndex("by_legacy", (q) => q.eq("legacyId", legacyId)).unique();
  if (!session) fail(404, "Attendance session not found.");
  // These values are immutable and determine every attendance bucket boundary.
  if (!Number.isInteger(session.count) || session.count < 1 || session.count > 1000 ||
      !Number.isInteger(session.bucketSize) || session.bucketSize < 1 || session.bucketSize > 100) {
    fail(503, "Invalid attendance session policy.");
  }
  return session;
}
