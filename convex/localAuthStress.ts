// Administrative fixtures only. Runtime auth never imports this module.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { sha256 } from "./rosters";

const scope = { run: v.string(), role: v.string() };
const scopedSession = { ...scope, sessionId: v.id("authSessions") };
type Ctx = QueryCtx | MutationCtx;
function gate(run: string, role: string) {
  const url = new URL(process.env.CONVEX_SITE_URL ?? "");
  if (url.href !== "http://127.0.0.1:3211/" || !/^[a-f0-9]{16}$/.test(run) ||
      !["rotation", "control", "race", "cleanup"].includes(role))
    throw new Error("Local auth fixture unavailable.");
}
const username = (run: string, role: string) => `authstress-${run}-${role}`;
async function actor(ctx: Ctx, run: string, role: string) {
  gate(run, role);
  const user = await ctx.db.query("users").withIndex("by_username", q => q.eq("username", username(run, role))).unique();
  if (user && (!user.ownerKey || user.isAnonymous)) throw new Error("Synthetic actor mismatch.");
  return user;
}
function registered(name: string | undefined): Id<"authSessions">[] {
  if (!name) return [];
  if (!/^local-auth-stress:[a-zA-Z0-9]+(?:,[a-zA-Z0-9]+)?$/.test(name)) throw new Error("Fixture registration mismatch.");
  return name.slice("local-auth-stress:".length).split(",") as Id<"authSessions">[];
}
async function owned(ctx: Ctx, run: string, role: string, sessionId: Id<"authSessions">) {
  const user = await actor(ctx, run, role);
  if (!user || !registered(user.name).includes(sessionId)) throw new Error("Exact synthetic session required.");
  const session = await ctx.db.get(sessionId);
  if (session && session.userId !== user._id) throw new Error("Synthetic session mismatch.");
  return { user, session };
}

export const register = internalMutation({ args: scopedSession, handler: async (ctx, a) => {
  const user = await actor(ctx, a.run, a.role);
  const session = await ctx.db.get(a.sessionId);
  if (!user || !session || session.userId !== user._id) throw new Error("Managed synthetic session required.");
  const sessions = registered(user.name);
  if (sessions.includes(a.sessionId) || sessions.length >= (a.role === "control" ? 2 : 1)) throw new Error("Registration bound exceeded.");
  sessions.push(a.sessionId);
  await ctx.db.patch(user._id, { name: `local-auth-stress:${sessions.join(",")}` });
  return { writes: 1 };
} });

export const status = internalQuery({ args: scopedSession, handler: async (ctx, a) => {
  const { session } = await owned(ctx, a.run, a.role, a.sessionId);
  // Admin-only bounded observation, never a runtime auth chain collection.
  const tokens = await ctx.db.query("authRefreshTokens").withIndex("sessionIdAndParentRefreshTokenId", q => q.eq("sessionId", a.sessionId)).take(502);
  const jobs = await ctx.db.system.query("_scheduled_functions").order("desc").take(1000);
  const cleanupJobs = jobs.filter(job => ["authSupport:cleanupSession", "authSupport.js:cleanupSession"].includes(job.name) && job.args[0]?.sessionId === a.sessionId);
  return { exists: session !== null, expiresAt: session?.expirationTime ?? null, tokenCount: tokens.length,
    tokenCountAtObservationBound: tokens.length === 502, cleanupJobs: cleanupJobs.length, scheduledScanComplete: jobs.length < 1000 };
} });

export const seedBatch = internalMutation({ args: { ...scopedSession, offset: v.number(), count: v.number() }, handler: async (ctx, a) => {
  if (a.role !== "cleanup" || !Number.isInteger(a.offset) || a.offset < 0 ||
      !Number.isInteger(a.count) || a.count < 1 || a.count > 100 || a.offset + a.count > 501)
    throw new Error("Seed bound exceeded.");
  const { session } = await owned(ctx, a.run, a.role, a.sessionId);
  if (!session || session.expirationTime <= Date.now()) throw new Error("Live managed session required.");
  const tokens = await ctx.db.query("authRefreshTokens").withIndex("sessionId", q => q.eq("sessionId", a.sessionId)).order("asc").take(502);
  if (tokens.length !== 1 + a.offset) throw new Error("Fixture seed offset mismatch.");
  let parent = tokens.at(-1)!._id;
  for (let i = 0; i < a.count; i++) {
    parent = await ctx.db.insert("authRefreshTokens", { sessionId: a.sessionId, parentRefreshTokenId: parent,
      expirationTime: session.expirationTime, firstUsedTime: Date.now() - 20000 });
  }
  return { writes: a.count };
} });

export const cleanupBatch = internalMutation({ args: scope, handler: async (ctx, a) => {
  const user = await actor(ctx, a.run, a.role);
  let writes = 0, cancelled = 0;
  const drop = async (rows: Array<{ _id: Id<"users"> | Id<"authSessions"> | Id<"authRefreshTokens"> | Id<"credentials"> | Id<"ownerLinks"> | Id<"gatewayNonces"> | Id<"throttleCounters"> }>) => {
    if (rows.length > 100) throw new Error("Cleanup bound exceeded.");
    for (const row of rows) { await ctx.db.delete(row._id); writes++; }
    return { done: false, writes, cancelled };
  };
  if (user) {
    const ids = registered(user.name);
    const live = await ctx.db.query("authSessions").withIndex("userId", q => q.eq("userId", user._id)).take(3);
    if (live.some(s => !ids.includes(s._id))) throw new Error("Unregistered synthetic session remains.");
    for (const sessionId of ids) {
      await owned(ctx, a.run, a.role, sessionId);
      const tokens = await ctx.db.query("authRefreshTokens").withIndex("sessionId", q => q.eq("sessionId", sessionId)).take(100);
      if (tokens.length) return drop(tokens);
    }
    const jobs = await ctx.db.system.query("_scheduled_functions").order("desc").take(1000);
    if (jobs.length === 1000) throw new Error("Scheduled cleanup observation bound exceeded.");
    for (const job of jobs) {
      if (["authSupport:cleanupSession", "authSupport.js:cleanupSession"].includes(job.name) && ids.includes(job.args[0]?.sessionId) && job.state.kind === "pending") {
        await ctx.scheduler.cancel(job._id); cancelled++; writes++;
      }
    }
    const credentials = await ctx.db.query("credentials").withIndex("by_username", q => q.eq("username", username(a.run, a.role))).unique();
    const links = await ctx.db.query("ownerLinks").withIndex("by_user_owner", q => q.eq("userId", user._id)).take(2);
    if (credentials?.userId !== user._id || links.length !== 1 || links[0].ownerKey !== user.ownerKey)
      throw new Error("Synthetic account ownership mismatch.");
    return drop([...live, credentials, ...links, user]);
  }
  // Proof nonces and rate counters are scoped to this run's unique IP hash and
  // nonce prefix; unrelated UI / gateway fixtures cannot match these keys.
  const nonces = await ctx.db.query("gatewayNonces").withIndex("by_nonce", q => q.gte("nonce", a.run + "0000000000000000").lt("nonce", a.run + "g")).take(100);
  if (nonces.length) return drop(nonces);
  const ipRows = await ctx.db.query("throttleCounters").withIndex("by_key_bucket", q => q.eq("key", `auth-ip:${sha256(a.run)}`)).take(4);
  const userRows = await ctx.db.query("throttleCounters").withIndex("by_key_bucket", q => q.eq("key", `auth-user:${username(a.run, a.role)}`)).take(4);
  if (ipRows.length || userRows.length) return drop([...ipRows, ...userRows]);
  return { done: true, writes, cancelled };
} });
