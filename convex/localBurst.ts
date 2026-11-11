// Administrative fixtures only: never called by the public gateway.
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { requireReady } from "./access";
import { readStudents, rosterDigest, sha256 } from "./rosters";

const TITLE = "Local shared-IP burst";
const MAX_DELETE = 100;
const args = { run: v.string() };
type Ctx = QueryCtx | MutationCtx;

function gate(run: string) {
  // The runtime supplies this URL; neither a caller argument nor an opt-in flag
  // can enable these functions on a hosted deployment.
  const url = new URL(process.env.CONVEX_SITE_URL ?? "");
  if (url.origin !== "http://127.0.0.1:3211" || url.href !== `${url.origin}/` ||
      !/^[a-f0-9]{24}$/.test(run)) throw new Error("Local burst fixture unavailable.");
}
const owner = (run: string) => `local-burst:${run}`;
const legacy = (run: string, size: number) => run + String(size).padStart(8, "0");
const rosterSize = (size: number) => size === 1001 ? 1000 : size;
const code = (ordinal: number) => `LB${String(ordinal + 1).padStart(4, "0")}`;
const name = (ordinal: number) => `Burst Student ${String(ordinal + 1).padStart(4, "0")}`;

async function actor(ctx: Ctx, run: string) {
  const user = await ctx.db.query("users").withIndex("by_username", q => q.eq("username", `burst-${run}`)).unique();
  if (user && user.ownerKey !== owner(run)) throw new Error("Fixture actor ownership mismatch.");
  return user;
}
async function ownedClass(ctx: Ctx, run: string, size: number) {
  const klass = await ctx.db.query("classes").withIndex("by_legacy", q => q.eq("legacyId", legacy(run, size))).unique();
  if (klass && (klass.ownerKey !== owner(run) || klass.title !== `${TITLE} ${size}`))
    throw new Error("Fixture class ownership mismatch.");
  return klass;
}
async function ownedSession(ctx: Ctx, run: string, size: number) {
  const klass = await ownedClass(ctx, run, size);
  const session = await ctx.db.query("sessions").withIndex("by_legacy", q => q.eq("legacyId", legacy(run, size))).unique();
  if (session && (!klass || session.classId !== klass._id || session.count !== rosterSize(size) ||
      session.bucketSize !== 100 || session.title !== `${TITLE} ${size}`))
    throw new Error("Fixture session ownership mismatch.");
  return { klass, session };
}

export const prepare = internalMutation({ args, handler: async (ctx, { run }) => {
  gate(run);
  await requireReady(ctx, true);
  if (await actor(ctx, run)) throw new Error("Fixture run already exists.");
  if (await ctx.db.query("ownerLinks").withIndex("by_owner", q => q.eq("ownerKey", owner(run))).unique())
    throw new Error("Fixture owner already exists.");
  for (const size of [30, 1000, 1001]) {
    const { klass, session } = await ownedSession(ctx, run, size);
    if (klass || session) throw new Error("Fixture run already exists.");
  }
  const userId = await ctx.db.insert("users", { username: `burst-${run}`, ownerKey: owner(run) });
  // Administrative impersonation needs a real session row, but no managed JWT,
  // refresh token, scheduler task, signup, or short expiry environment setting.
  const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: Date.now() + 86400000 });
  await ctx.db.insert("ownerLinks", { ownerKey: owner(run), userId, directoryComplete: true });
  return { subject: `${userId}|${sessionId}` };
} });

export const snapshot = internalQuery({ args: { ...args, size: v.number() }, handler: async (ctx, { run, size }) => {
  gate(run);
  if (![30, 1000, 1001].includes(size)) throw new Error("Invalid fixture size.");
  const user = await actor(ctx, run);
  const { klass, session } = await ownedSession(ctx, run, size);
  if (!user || !klass || !session) throw new Error("Fixture missing.");
  const state = await ctx.db.query("classState").withIndex("by_class", q => q.eq("classId", klass._id)).unique();
  const version = await ctx.db.get(session.rosterVersionId);
  const membership = await ctx.db.query("memberships").withIndex("by_class_user", q => q.eq("classId", klass._id).eq("userId", user._id)).unique();
  const link = await ctx.db.query("ownerLinks").withIndex("by_owner", q => q.eq("ownerKey", owner(run))).unique();
  if (!version || version.classId !== klass._id || version.count !== rosterSize(size) || state?.revision !== 1 ||
      state.rosterVersionId !== version._id || membership?.role !== "owner" || link?.userId !== user._id)
    throw new Error("Invalid fixture metadata.");
  const students = await readStudents(ctx, version);
  if (students.some((s, i) => s.id !== String(i + 1) || s.name !== name(i) || s.code !== code(i)) ||
      rosterDigest(students) !== version.digest) throw new Error("Invalid fixture roster.");
  const rows = await ctx.db.query("attendance").withIndex("by_session_bucket_student", q => q.eq("sessionId", session._id)).take(rosterSize(size) + 1);
  const seen = new Set<string>();
  for (const row of rows) {
    const ordinal = Number(row.studentId) - 1;
    if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= rosterSize(size) || row.studentId !== String(ordinal + 1) ||
        row.bucket !== Math.floor(ordinal / 100) || seen.has(row.studentId) ||
        !row.checkedInAt || !Number.isFinite(Date.parse(row.checkedInAt)) || row.excusedAt !== undefined || row.excusedBy !== undefined)
      throw new Error("Invalid attendance fact.");
    seen.add(row.studentId);
  }
  const closures = await ctx.db.query("closures").withIndex("by_session", q => q.eq("sessionId", session._id)).take(1);
  if (closures.length) throw new Error("Fixture unexpectedly closed.");
  return {
    // Only the script retains fact IDs/timestamps; the evidence contains counts
    // and comparisons. Hash ALL immutable metadata, including roster contents.
    metadataDigest: sha256(JSON.stringify([klass, session, state, version, students, membership, link])),
    count: rows.length,
    facts: rows.map(r => ({ ordinal: Number(r.studentId) - 1, id: r._id, creationTime: r._creationTime, checkedInAt: r.checkedInAt })),
  };
} });

// Fixture-only deterministic seed names are distinct from production-shaped random proofs.
const seedNonce = (run: string, partition: number, ordinal: number) =>
  run + (partition * 32 + ordinal).toString(16).padStart(8, "0");
export const seed = internalMutation({ args: { ...args, partition: v.number() }, handler: async (ctx, { run, partition }) => {
  gate(run);
  if (!Number.isInteger(partition) || partition < 0 || partition >= 64 || !(await actor(ctx, run))) throw new Error("Invalid seed.");
  const now = Date.now();
  for (let i = 0; i < 26; i++) {
    const nonce = seedNonce(run, partition, i);
    if (await ctx.db.query("gatewayNonces").withIndex("by_nonce", q => q.eq("nonce", nonce)).unique()) throw new Error("Seed exists.");
    await ctx.db.insert("gatewayNonces", { nonce, expiresAt: i === 24 ? now + 86400000 : now - 1000,
      ...(i === 25 ? {} : { partition }) } as any);
    await ctx.db.insert("throttleCounters", { key: `local-burst-seed:${run}:${partition}:${i}`, bucket: 0, count: 1,
      expiresAt: i === 24 ? now + 86400000 : now - 1000, ...(i === 25 ? {} : { partition }) } as any);
  }
  return { writes: 52 };
} });

export const exhaust = internalMutation({ args, handler: async (ctx, { run }) => {
  gate(run);
  if (!(await actor(ctx, run))) throw new Error("Fixture missing.");
  const bucket = Math.floor(Date.now() / 900000);
  const identityHash = sha256(`${legacy(run, 1001)}:exhausted-control`);
  const key = `student:${sha256(run)}:${identityHash}`;
  if (await ctx.db.query("throttleCounters").withIndex("by_key_bucket", q => q.eq("key", key).eq("bucket", bucket)).unique()) throw new Error("Control exists.");
  await ctx.db.insert("throttleCounters", { key, bucket, count: 12, expiresAt: (bucket + 1) * 900000, partition: 0 } as any);
  return { writes: 1, bucket };
} });

export const security = internalQuery({ args: { ...args, nonces: v.array(v.string()) }, handler: async (ctx, { run, nonces }) => {
  gate(run);
  if (nonces.length > 100 || nonces.some(n => !/^[a-f0-9]{32}$/.test(n))) throw new Error("Invalid inventory.");
  const occupancy = Array(64).fill(0), ipChosen = Array(64).fill(0), sessionChosen = Array(64).fill(0);
  let found = 0, encoded = 0, ipFallback = 0, sessionFallback = 0;
  for (const nonce of nonces) {
    const row = await ctx.db.query("gatewayNonces").withIndex("by_nonce", q => q.eq("nonce", nonce)).unique();
    if (!row) continue;
    found++;
    const primary = parseInt(nonce.slice(-8), 16) % 64;
    occupancy[primary]++;
    const encodedPartitions = (row as any).quotaPartitions;
    if (Number.isInteger(encodedPartitions) && encodedPartitions >= 0 && encodedPartitions < 4096) {
      const ip = Math.floor(encodedPartitions / 64), session = encodedPartitions % 64;
      encoded++; ipChosen[ip]++; sessionChosen[session]++;
      if (ip !== primary) ipFallback++;
      if (session !== primary) sessionFallback++;
    }
  }
  return { requested: nonces.length, found, encoded, occupancy, ipChosen, sessionChosen, ipFallback, sessionFallback };
} });
export const counterTotals = internalQuery({ args: { ...args, bucket: v.number(), size: v.number() }, handler: async (ctx, { run, bucket, size }) => {
  gate(run);
  if (![30, 1000, 1001].includes(size) || !Number.isSafeInteger(bucket)) throw new Error("Invalid counter request.");
  const ip = sha256(run);
  const result = { ip: Array(64).fill(0), session: Array(64).fill(0) };
  for (let p = 0; p < 64; p++) {
    const suffix = String(p).padStart(2, "0");
    for (const [kind, key] of [["ip", `student-ip:${ip}:p:${suffix}`], ["session", `student-session:${ip}:${legacy(run, size)}:p:${suffix}`]] as const) {
      const row = await ctx.db.query("throttleCounters").withIndex("by_key_bucket", q => q.eq("key", key).eq("bucket", bucket)).unique();
      result[kind][p] = row?.count ?? 0;
    }
  }
  return result;
} });
export const seedInventory = internalQuery({ args, handler: async (ctx, { run }) => {
  gate(run);
  let minNonces = 24, minCounters = 24;
  const now = Date.now();
  for (let p = 0; p < 64; p++) {
    let nonces = 0, counters = 0;
    for (let i = 0; i < 24; i++) {
      const n = await ctx.db.query("gatewayNonces").withIndex("by_nonce", q => q.eq("nonce", seedNonce(run, p, i))).unique();
      const c = await ctx.db.query("throttleCounters").withIndex("by_key_bucket", q => q.eq("key", `local-burst-seed:${run}:${p}:${i}`).eq("bucket", 0)).unique();
      if (n && n.expiresAt < now && (n as any).partition === p) nonces++;
      if (c && c.expiresAt < now && (c as any).partition === p) counters++;
    }
    minNonces = Math.min(minNonces, nonces); minCounters = Math.min(minCounters, counters);
  }
  return { minNonces, minCounters };
} });
export const sentinels = internalQuery({ args, handler: async (ctx, { run }) => {
  gate(run);
  let live = 0, legacy = 0;
  for (let p = 0; p < 64; p++) for (const i of [24, 25]) {
    const n = await ctx.db.query("gatewayNonces").withIndex("by_nonce", q => q.eq("nonce", seedNonce(run, p, i))).unique();
    const c = await ctx.db.query("throttleCounters").withIndex("by_key_bucket", q => q.eq("key", `local-burst-seed:${run}:${p}:${i}`).eq("bucket", 0)).unique();
    if (i === 24) live += Number(!!n) + Number(!!c); else legacy += Number(!!n) + Number(!!c);
  }
  return { live, legacy, expectedEach: 128 };
} });

async function securityRows(ctx: Ctx, run: string, limit: number) {
  const ip = sha256(run), prefix = `student:${ip}:`, seed = `local-burst-seed:${run}:`;
  const students = await ctx.db.query("throttleCounters").withIndex("by_key_bucket", q => q.gte("key", prefix).lt("key", prefix + "\uffff")).take(limit);
  const seeded = await ctx.db.query("throttleCounters").withIndex("by_key_bucket", q => q.gte("key", seed).lt("key", seed + "\uffff")).take(limit);
  const shared = [];
  for (const base of [`student-ip:${ip}`, ...[30, 1000, 1001].map(size => `student-session:${ip}:${legacy(run, size)}`)]) {
    for (const key of [base, ...Array.from({ length: 64 }, (_, p) => `${base}:p:${String(p).padStart(2, "0")}`)]) {
      shared.push(...await ctx.db.query("throttleCounters").withIndex("by_key_bucket", q => q.eq("key", key)).take(4));
    }
  }
  return { students, shared, seeded };
}
export const cleanupBatch = internalMutation({ args: { ...args, nonces: v.array(v.string()) }, handler: async (ctx, { run, nonces: inventory }) => {
  gate(run);
  if (inventory.length > 100 || inventory.some(n => !/^[a-f0-9]{32}$/.test(n))) throw new Error("Invalid inventory.");
  // Every lookup is indexed and bounded. Each transaction deletes at most 100
  // rows, and only within exact run ownership / nonce / IP-hash scope.
  const drop = async (rows: Array<{ _id: any }>) => {
    if (rows.length > MAX_DELETE) throw new Error("Cleanup budget exceeded.");
    for (const row of rows) await ctx.db.delete(row._id);
    return { deleted: rows.length, done: false, inventoryDone: false };
  };
  const nonces = await ctx.db.query("gatewayNonces").withIndex("by_nonce", q => q.gte("nonce", run + "00000000").lt("nonce", run + "g")).take(MAX_DELETE);
  if (nonces.length) return drop(nonces);
  const inventoryRows = [];
  for (const nonce of inventory) {
    const row = await ctx.db.query("gatewayNonces").withIndex("by_nonce", q => q.eq("nonce", nonce)).unique();
    if (row) inventoryRows.push(row);
  }
  if (inventoryRows.length) return drop(inventoryRows);
  if (inventory.length) return { deleted: 0, done: false, inventoryDone: true };
  const { students, shared, seeded } = await securityRows(ctx, run, MAX_DELETE);
  if (students.length || shared.length || seeded.length) return drop([...students, ...shared, ...seeded].slice(0, MAX_DELETE));
  for (const size of [30, 1000, 1001]) {
    const { klass, session } = await ownedSession(ctx, run, size);
    if (!klass) continue;
    if (session) {
      const facts = await ctx.db.query("attendance").withIndex("by_session_bucket_student", q => q.eq("sessionId", session._id)).take(MAX_DELETE);
      if (facts.length) return drop(facts);
      const closures = await ctx.db.query("closures").withIndex("by_session", q => q.eq("sessionId", session._id)).take(MAX_DELETE);
      if (closures.length) return drop(closures);
      return drop([session]);
    }
    const versions = await ctx.db.query("rosterVersions").withIndex("by_class_digest", q => q.eq("classId", klass._id)).take(2);
    if (versions.length > 1) throw new Error("Unexpected fixture versions.");
    if (versions[0]) {
      const version = versions[0];
      if (version.sourceKey !== `live:${klass._id}:${version.digest}` || version.count !== rosterSize(size))
        throw new Error("Roster cleanup ownership mismatch.");
      const members = await ctx.db.query("rosterMembers").withIndex("by_version_order", q => q.eq("versionId", version._id)).take(MAX_DELETE);
      if (members.length) return drop(members);
      return drop([version]);
    }
    const states = await ctx.db.query("classState").withIndex("by_class", q => q.eq("classId", klass._id)).take(2);
    if (states.length > 1) throw new Error("Unexpected class states.");
    if (states.length) return drop(states);
    const memberships = await ctx.db.query("memberships").withIndex("by_class_user", q => q.eq("classId", klass._id)).take(2);
    const user = await actor(ctx, run);
    if (memberships.some(m => m.userId !== user?._id || m.role !== "owner")) throw new Error("Unexpected fixture membership.");
    if (memberships.length) return drop(memberships);
    return drop([klass]);
  }
  const user = await actor(ctx, run);
  const link = await ctx.db.query("ownerLinks").withIndex("by_owner", q => q.eq("ownerKey", owner(run))).unique();
  if (link && link.userId !== user?._id) throw new Error("Owner cleanup mismatch.");
  if (link) return drop([link]);
  if (user) {
    const sessions = await ctx.db.query("authSessions").withIndex("userId", q => q.eq("userId", user._id)).take(2);
    if (sessions.length > 1) throw new Error("Unexpected fixture auth sessions.");
    if (sessions.length) return drop(sessions);
    return drop([user]);
  }
  return { deleted: 0, done: true, inventoryDone: false };
} });
