// Administrative loopback fixtures only. No public diagnostic query exports.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { sha256 } from "./rosters";

const scope = { run: v.string() };
const roles = ["owner", "teacher"] as const;
const sizes = [30, 1000] as const;
type Ctx = QueryCtx | MutationCtx;
function gate(run: string) {
  if (process.env.CONVEX_SITE_URL !== "http://127.0.0.1:3211" || !/^[a-f0-9]{16}$/.test(run))
    throw new Error("Local subscription fixtures unavailable.");
}
const username = (run: string, role: string) => `sub-${run}-${role}`;
const legacy = (run: string, size: number) => run + String(size).padStart(16, "0");
const registration = (id: Id<"authSessions">) => `local-subscriptions:${id}`;

async function actor(ctx: Ctx, run: string, role: string) {
  gate(run);
  if (!roles.some(r => r === role)) throw new Error("Invalid fixture role.");
  const user = await ctx.db.query("users").withIndex("by_username", q => q.eq("username", username(run, role))).unique();
  if (user && (!user.ownerKey || user.isAnonymous)) throw new Error("Actor ownership mismatch.");
  return user;
}

export const register = internalMutation({
  args: { ...scope, role: v.string(), sessionId: v.id("authSessions") },
  handler: async (ctx, a) => {
    const user = await actor(ctx, a.run, a.role);
    const session = await ctx.db.get(a.sessionId);
    if (!user || user.name || !session || session.userId !== user._id || session.expirationTime <= Date.now())
      throw new Error("Fresh managed actor required.");
    const sessions = await ctx.db.query("authSessions").withIndex("userId", q => q.eq("userId", user._id)).take(2);
    if (sessions.length !== 1 || sessions[0]._id !== a.sessionId) throw new Error("Unexpected managed sessions.");
    await ctx.db.patch(user._id, { name: registration(a.sessionId) });
    return { writes: 1 };
  },
});

// A unique argument prevents query cache reuse. The sole log line has no actor,
// credential, roster, or attendance content. This query never writes telemetry.
export const checkpoint = internalQuery({
  args: { ...scope, sequence: v.number() },
  handler: async (_ctx, { run, sequence }) => {
    gate(run);
    if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 2000) throw new Error("Invalid checkpoint.");
    console.log(`LS_CHECKPOINT_${sequence}`);
    return sequence;
  },
});

async function ownedClass(ctx: Ctx, run: string, size: number) {
  const user = await actor(ctx, run, "owner");
  const klass = await ctx.db.query("classes").withIndex("by_legacy", q => q.eq("legacyId", legacy(run, size))).unique();
  if (klass && (!user || klass.ownerKey !== user.ownerKey || klass.title !== `Local subscriptions ${size}`))
    throw new Error("Class ownership mismatch.");
  return klass;
}

export const snapshot = internalQuery({ args: scope, handler: async (ctx, { run }) => {
  gate(run);
  const facts = [], metadata = [];
  for (const size of sizes) {
    const klass = await ownedClass(ctx, run, size);
    if (!klass) continue;
    metadata.push(klass);
    const sessions = await ctx.db.query("sessions").withIndex("by_class_created", q => q.eq("classId", klass._id)).take(3);
    if (sessions.length > 2 || sessions.some(s => ![legacy(run, size), legacy(run, 1001)].includes(s.legacyId)))
      throw new Error("Session ownership mismatch.");
    for (const session of sessions) {
      metadata.push(session);
      facts.push(...await ctx.db.query("attendance").withIndex("by_session_bucket_student", q => q.eq("sessionId", session._id)).take(31));
      metadata.push(...await ctx.db.query("closures").withIndex("by_session", q => q.eq("sessionId", session._id)).take(2));
    }
    metadata.push(...await ctx.db.query("classState").withIndex("by_class", q => q.eq("classId", klass._id)).take(2));
    metadata.push(...await ctx.db.query("memberships").withIndex("by_class_user", q => q.eq("classId", klass._id)).take(3));
    const versions = await ctx.db.query("rosterVersions").withIndex("by_class_digest", q => q.eq("classId", klass._id)).take(2);
    for (const version of versions) {
      metadata.push(version);
      metadata.push(...await ctx.db.query("rosterMembers").withIndex("by_version_order", q => q.eq("versionId", version._id)).take(size + 1));
    }
  }
  return { domainDigest: sha256(JSON.stringify([metadata, facts])), factCount: facts.length };
} });

export const cleanupBatch = internalMutation({ args: scope, handler: async (ctx, { run }) => {
  gate(run);
  let cancelled = 0;
  const drop = async (rows: Array<{ _id: any }>) => {
    if (rows.length + cancelled > 100) throw new Error("Cleanup batch exceeded.");
    for (const row of rows) await ctx.db.delete(row._id);
    return { done: false, writes: rows.length + cancelled, cancelled };
  };
  const users = await Promise.all(roles.map(role => actor(ctx, run, role)));
  // Class IDs, owner keys, session IDs, and membership endpoints must all match
  // this exact run. No table-wide deletes or removal of another fake workload.
  for (const size of sizes) {
    const klass = await ownedClass(ctx, run, size);
    if (!klass) continue;
    const sessions = await ctx.db.query("sessions").withIndex("by_class_created", q => q.eq("classId", klass._id)).take(3);
    if (sessions.length > 2 || sessions.some(s => ![legacy(run, size), legacy(run, 1001)].includes(s.legacyId)))
      throw new Error("Unexpected fixture session.");
    for (const session of sessions) {
      const facts = await ctx.db.query("attendance").withIndex("by_session_bucket_student", q => q.eq("sessionId", session._id)).take(100);
      if (facts.length) return drop(facts);
      const closures = await ctx.db.query("closures").withIndex("by_session", q => q.eq("sessionId", session._id)).take(2);
      if (closures.length) return drop(closures);
      return drop([session]);
    }
    const versions = await ctx.db.query("rosterVersions").withIndex("by_class_digest", q => q.eq("classId", klass._id)).take(2);
    if (versions.length > 1) throw new Error("Unexpected fixture roster versions.");
    if (versions[0]) {
      const version = versions[0];
      if (version.count !== size || version.sourceKey !== `live:${klass._id}:${version.digest}`)
        throw new Error("Roster ownership mismatch.");
      const members = await ctx.db.query("rosterMembers").withIndex("by_version_order", q => q.eq("versionId", version._id)).take(100);
      if (members.length) return drop(members);
      return drop([version]);
    }
    const state = await ctx.db.query("classState").withIndex("by_class", q => q.eq("classId", klass._id)).take(2);
    if (state.length > 1) throw new Error("Unexpected class state.");
    if (state.length) return drop(state);
    const edges = await ctx.db.query("memberships").withIndex("by_class_user", q => q.eq("classId", klass._id)).take(3);
    if (edges.some(e => !users.some(u => u?._id === e.userId)) || edges.length > 2)
      throw new Error("Unexpected fixture teacher.");
    if (edges.length) return drop(edges);
    return drop([klass]);
  }
  for (const [index, user] of users.entries()) {
    if (!user) continue;
    const sessions = await ctx.db.query("authSessions").withIndex("userId", q => q.eq("userId", user._id)).take(2);
    if (sessions.length > 1 || sessions.some(s => user.name !== registration(s._id)))
      throw new Error("Unregistered managed session.");
    for (const session of sessions) {
      const tokens = await ctx.db.query("authRefreshTokens").withIndex("sessionId", q => q.eq("sessionId", session._id)).take(100);
      if (tokens.length) return drop(tokens);
    }
    const credentials = await ctx.db.query("credentials").withIndex("by_username", q => q.eq("username", username(run, roles[index]))).unique();
    const links = await ctx.db.query("ownerLinks").withIndex("by_user_owner", q => q.eq("userId", user._id)).take(2);
    if (credentials?.userId !== user._id || links.length !== 1 || links[0].ownerKey !== user.ownerKey)
      throw new Error("Credential ownership mismatch.");
    const edges = await ctx.db.query("memberships").withIndex("by_user_class", q => q.eq("userId", user._id)).take(1);
    const classes = await ctx.db.query("classes").withIndex("by_owner", q => q.eq("ownerKey", user.ownerKey!)).take(1);
    if (edges.length || classes.length) throw new Error("Actor still owns domain data.");
    const jobs = await ctx.db.system.query("_scheduled_functions").order("desc").take(1000);
    if (jobs.length === 1000) throw new Error("Scheduled cleanup observation bound exceeded.");
    for (const job of jobs) {
      if (["authSupport:cleanupSession", "authSupport.js:cleanupSession"].includes(job.name) &&
          sessions.some(session => session._id === job.args[0]?.sessionId) && job.state.kind === "pending") {
        await ctx.scheduler.cancel(job._id);
        cancelled++;
      }
    }
    return drop([...sessions, credentials, ...links, user]);
  }
  const nonces = await ctx.db.query("gatewayNonces").withIndex("by_nonce", q => q.gte("nonce", run + "0000000000000000").lt("nonce", run + "g")).take(100);
  if (nonces.length) return drop(nonces);
  const ip = sha256(run);
  const keys = [`auth-ip:${ip}`, ...roles.map(role => `auth-user:${username(run, role)}`)];
  // This runner sends exactly two student gateway requests, each in one of the
  // 64 quota partitions, and never seeds legacy shared counters.
  for (const base of [`student-ip:${ip}`, `student-session:${ip}:${legacy(run, 1000)}`]) {
    keys.push(base);
    for (let p = 0; p < 64; p++) keys.push(`${base}:p:${String(p).padStart(2, "0")}`);
  }
  keys.push(`student:${ip}:${sha256(`${legacy(run, 1000)}:ls0001`)}`);
  const counters = [];
  for (const key of keys) counters.push(...await ctx.db.query("throttleCounters").withIndex("by_key_bucket", q => q.eq("key", key)).take(4));
  if (counters.length) return drop(counters.slice(0, 100));
  return { done: true, writes: 0, cancelled };
} });
