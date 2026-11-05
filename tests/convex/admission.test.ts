/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { getFunctionName, makeFunctionReference } from "convex/server";
import schema from "../../convex/schema";
import { reserve } from "../../convex/authSupport";
import { checkin, publicInfo } from "../../convex/gateway";
import { pruneSecurity } from "../../convex/operations";
import { broadCapacity, noncePartitions, partitionKey } from "../../convex/admission";
import { signGatewayRequest } from "../../lib/gateway-proof.mjs";
import { sha256 } from "../../convex/rosters";

const modules = import.meta.glob("../../convex/**/*.ts");
const ref = (name: string) => makeFunctionReference<any>(name) as any;
const now = 1_800_000_000_000;
const windowMs = 900_000;
const bucket = Math.floor(now / windowMs);
const ipHash = "a".repeat(64);
const username = "b".repeat(64);
const legacyId = "c".repeat(32);
const fingerprint = "d".repeat(64);
const ipBase = `student-ip:${ipHash}`;
const sessionBase = `student-session:${ipHash}:${legacyId}`;
const identityKey = `student:${ipHash}:${username}`;
const secret = "synthetic-admission-test-key-at-least-32-bytes";
const audience = "admission-tests";
const nonce = (primary: number, ordinal = 1, first = 0) =>
  first.toString(16).padStart(8, "0") + ordinal.toString(16).padStart(16, "0") + primary.toString(16).padStart(8, "0");
const args = (primary = 7, ordinal = 1) => ({
  nonce: nonce(primary, ordinal), issuedAt: Date.now(), ipHash, username,
  operation: "checkin", sessionLegacyId: legacyId,
});
const counts = { accounts: 0, legacyClaims: 0, classes: 0, rosterVersions: 0,
  rosterMembers: 0, memberships: 0, sessions: 0, closures: 0, attendance: 0 };
async function setup() {
  const t = convexTest(schema, modules);
  // convex-test advances commit timestamps monotonically, even under a fixed
  // fake clock. Seed before the test instant so exact proof edges stay exact.
  vi.setSystemTime(now - 1000);
  await t.run(async ctx => {
    const activeRunId = await ctx.db.insert("migrationRuns", {
      fingerprint, status: "active", exportedAt: new Date(now).toISOString(), expectedCounts: counts,
    });
    await ctx.db.insert("deploymentState", { key: "migration", activeRunId, readsEnabled: true, writesEnabled: true });
  });
  vi.setSystemTime(now);
  return t;
}
type Test = Awaited<ReturnType<typeof setup>>;
const reserveAt = (t: Test, a = args()) => t.mutation(ref("authSupport:reserve"), a);
const state = (t: Test) => t.run(async ctx => ({
  nonces: await ctx.db.query("gatewayNonces").collect(), counters: await ctx.db.query("throttleCounters").collect(),
}));
async function seedCounter(t: Test, key: string, count: number, partition?: number) {
  return t.run(ctx => ctx.db.insert("throttleCounters", {
    key, count, bucket, expiresAt: (bucket + 1) * windowMs, ...(partition === undefined ? {} : { partition }),
  }));
}
async function fillBroad(t: Test, kind: "ip" | "session", p: number, shortBy = 0) {
  return seedCounter(t, partitionKey(kind === "ip" ? ipBase : sessionBase, p), broadCapacity(kind, p) - shortBy, p);
}

// Instrument the real transaction's DB to enforce indexed equality/range access,
// and count actual counter lookups (including absence reads), not just writes.
async function tracedSecurityMutation(t: Test, handler: any, a: unknown) {
  const reads: Array<{ table: string; index: string; bounds: unknown[][]; take?: number }> = [];
  const result = await t.run(async ctx => {
    const db = new Proxy(ctx.db, {
      get(target, property) {
        if (property !== "query") {
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (table: string) => {
          const query = (target.query as any)(table);
          if (table !== "gatewayNonces" && table !== "throttleCounters") return query;
          return { withIndex(index: string, callback: any) {
            const entry = { table, index, bounds: [] as unknown[][], take: undefined as number | undefined };
            reads.push(entry);
            expect(["by_nonce", "by_key_bucket", "by_partition_expiry"]).toContain(index);
            const range = query.withIndex(index, (q: any) => {
              const recorder: any = {};
              for (const op of ["eq", "lt", "lte", "gt", "gte"]) recorder[op] = (...values: unknown[]) => {
                entry.bounds.push([op, ...values]); q = q[op](...values); return recorder;
              };
              callback(recorder); return q;
            });
            return { unique: () => range.unique(), take: (n: number) => { entry.take = n; return range.take(n); } };
          } };
        };
      },
    });
    return handler._handler({ ...ctx, db }, a);
  });
  return { result, reads };
}
const tracedReserve = (t: Test, a = args()) => tracedSecurityMutation(t, reserve, a);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now });
  vi.stubEnv("ATTENDANCE_GATEWAY_KEY", secret);
  vi.stubEnv("ATTENDANCE_GATEWAY_AUDIENCE", audience);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("partitioned admission capacity", () => {
  it("distributes every remainder exactly and uses unsigned, distinct nonce candidates", () => {
    let ip = 0, session = 0;
    for (let p = 0; p < 64; p++) {
      expect(broadCapacity("ip", p)).toBe(p < 16 ? 157 : 156);
      expect(broadCapacity("session", p)).toBe(p < 56 ? 47 : 46);
      ip += broadCapacity("ip", p); session += broadCapacity("session", p);
      for (const first of [0, 62, 63, 0x80000000, 0xffffffff]) {
        const candidates = noncePartitions(nonce(p, 1, first));
        expect(candidates).toEqual({ primary: p, alternate: (p + 1 + first % 63) % 64 });
        expect(candidates.alternate).not.toBe(p);
      }
      expect(partitionKey(ipBase, p)).toBe(`${ipBase}:p:${String(p).padStart(2, "0")}`);
    }
    expect(ip).toBe(10000); expect(session).toBe(3000);
    expect(noncePartitions("f".repeat(32))).toEqual({ primary: 63, alternate: 3 });
  });

  it.each(Array.from({ length: 64 }, (_, p) => p))("admits exactly the last permit at partition %i", async p => {
    const t = await setup(), alternate = (p + 1) % 64;
    for (const kind of ["ip", "session"] as const) {
      await fillBroad(t, kind, p, 1); await fillBroad(t, kind, alternate);
    }
    expect(await reserveAt(t, args(p))).toBe(true);
    const before = await state(t);
    expect(before.nonces[0].quotaPartitions).toBe(p * 64 + p);
    expect(await reserveAt(t, args(p, 2))).toBe(false);
    expect(await state(t)).toEqual(before);
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])(
    "chooses IP fallback=%s and session fallback=%s independently", async (ipFallback, sessionFallback) => {
      const t = await setup(), p = 7, alt = 8;
      if (ipFallback) await fillBroad(t, "ip", p);
      if (sessionFallback) await fillBroad(t, "session", p);
      const { result, reads } = await tracedReserve(t);
      expect(result).toBe(true);
      const ipP = ipFallback ? alt : p, sessionP = sessionFallback ? alt : p;
      const after = await state(t);
      expect(after.nonces[0]).toMatchObject({ partition: p, quotaPartitions: ipP * 64 + sessionP, expiresAt: now + 60001 });
      for (const [base, chosen, fallback] of [[ipBase, ipP, ipFallback], [sessionBase, sessionP, sessionFallback]] as const) {
        const lookups = reads.filter(r => r.index === "by_key_bucket" && String(r.bounds[0][2]).startsWith(base + ":p:"));
        expect(lookups.map(r => r.bounds[0][2])).toEqual(fallback ? [partitionKey(base, p), partitionKey(base, alt)] : [partitionKey(base, p)]);
        expect(after.counters.find(r => r.key === partitionKey(base, chosen))).toMatchObject({ count: 1, partition: chosen });
      }
    },
  );

  it.each(["ip", "session", "identity"] as const)("rejects exhausted %s with no partial writes, cleanup, or third-partition read", async kind => {
    const t = await setup();
    if (kind === "identity") await seedCounter(t, identityKey, 12);
    else { await fillBroad(t, kind, 7); await fillBroad(t, kind, 8); }
    await t.run(async ctx => {
      await ctx.db.insert("gatewayNonces", { nonce: "expired", expiresAt: now - 1, partition: 7 });
      await ctx.db.insert("throttleCounters", { key: "expired", count: 1, bucket: bucket - 1, expiresAt: now - 1, partition: 7 });
    });
    const before = await state(t), { result, reads } = await tracedReserve(t);
    expect(result).toBe(false); expect(await state(t)).toEqual(before);
    expect(reads.some(r => r.index === "by_partition_expiry")).toBe(false);
    const keys = reads.filter(r => r.index === "by_key_bucket").map(r => String(r.bounds[0][2]));
    expect(keys.every(k => k === identityKey || k.endsWith(":p:07") || k.endsWith(":p:08"))).toBe(true);
  });

  it("serializes competitors for the last broad permit and concurrent presentations of one proof", async () => {
    const t = await setup();
    for (const kind of ["ip", "session"] as const) { await fillBroad(t, kind, 7, 1); await fillBroad(t, kind, 8); }
    const results = await Promise.all([reserveAt(t), reserveAt(t, { ...args(7, 2), username: "e".repeat(64) })]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await state(t)).nonces).toHaveLength(1);
    const t2 = await setup(), proof = args(9);
    expect((await Promise.all(Array.from({ length: 5 }, () => reserveAt(t2, proof)))).filter(Boolean)).toHaveLength(1);
    expect((await state(t2)).counters.map(r => r.count)).toEqual([1, 1, 1]);
  });


  it("serializes the last exact identity permit across different broad partitions", async () => {
    const t = await setup(); await seedCounter(t, identityKey, 11);
    const results = await Promise.all([reserveAt(t), reserveAt(t, args(42, 2))]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const after = await state(t);
    expect(after.nonces).toHaveLength(1);
    expect(after.counters.find(c => c.key === identityKey)?.count).toBe(12);
    expect(after.counters.filter(c => c.key !== identityKey)).toHaveLength(2);
  });

  it("keeps the exact identity allowance across different quota partitions and sessions", async () => {
    const t = await setup(); await seedCounter(t, identityKey, 11);
    expect(await reserveAt(t)).toBe(true);
    const before = await state(t);
    expect(await reserveAt(t, { ...args(42, 2), sessionLegacyId: "f".repeat(32) })).toBe(false);
    expect(await state(t)).toEqual(before);
  });

  it.each([
    { username: undefined }, { username: "student123" }, { username: "A".repeat(64) },
    { username: "a".repeat(63) }, { sessionLegacyId: "bad" }, { nonce: "g".repeat(32) },
    { ipHash: "bad" }, { operation: "other" }, { issuedAt: now + 10001 }, { issuedAt: now - 60001 },
    { issuedAt: now + 0.1 },
  ])("rejects malformed check-in reservations before security reads/writes: %j", async patch => {
    const t = await setup();
    const { result, reads } = await tracedReserve(t, { ...args(), ...patch } as any);
    expect(result).toBe(false); expect(reads).toEqual([]);
    expect(await state(t)).toEqual({ nonces: [], counters: [] });
  });

  it.each([undefined, "Abc", " abcd", "ab", "a".repeat(41), "teacher@school"])("rejects unnormalized credential username %j", async username => {
    const t = await setup(), { result, reads } = await tracedReserve(t, { ...args(), operation: "login", username } as any);
    expect(result).toBe(false); expect(reads).toEqual([]);
  });

  it("keeps credential limits unpartitioned at IP40/user12 and initializes stable assignments", async () => {
    const t = await setup();
    const user = await seedCounter(t, "auth-user:teacher", 10);
    const ip = await seedCounter(t, `auth-ip:${ipHash}`, 38, 3);
    for (const [i, operation] of [[1, "signup"], [2, "login"]] as const)
      expect(await reserveAt(t, { ...args(7 + i, i), operation, username: "teacher" })).toBe(true);
    expect(await t.run(ctx => ctx.db.get(user))).toMatchObject({ count: 12, partition: 8 });
    expect(await t.run(ctx => ctx.db.get(ip))).toMatchObject({ count: 40, partition: 3 });
    const before = await state(t);
    expect(await reserveAt(t, { ...args(20, 3), operation: "login", username: "teacher" })).toBe(false);
    expect(await reserveAt(t, { ...args(20, 4), operation: "login", username: "another" })).toBe(false);
    expect(await state(t)).toEqual(before);
    expect(before.nonces.every(n => n.quotaPartitions === undefined)).toBe(true);
  });
});

describe("proof lifetime and fixed receiver-time buckets", () => {
  it.each([-60000, 10000])("accepts the inclusive issuance offset %i and retains replay binding", async offset => {
    const t = await setup(), a = { ...args(), issuedAt: now + offset };
    expect(await reserveAt(t, a)).toBe(true);
    const saved = await state(t);
    expect(saved.nonces[0].expiresAt).toBe(a.issuedAt + 60001);
    expect(await reserveAt(t, a)).toBe(false);
    expect(await state(t)).toEqual(saved);
  });

  it("uses the receiver's current bucket for a previous-bucket proof and a future-bucket proof", async () => {
    const t = await setup();
    vi.setSystemTime(now + windowMs - 5);
    const previousProof = args();
    expect(await reserveAt(t, previousProof)).toBe(true);
    vi.setSystemTime(now + windowMs + 5);
    expect(await reserveAt(t, { ...args(7, 2), issuedAt: previousProof.issuedAt })).toBe(true);
    // Old bucket counters can expire before nonce receipts. Replay still fails.
    expect(await reserveAt(t, previousProof)).toBe(false);
    expect((await state(t)).nonces).toHaveLength(2);
    expect((await state(t)).counters.every(r => r.bucket === bucket + 1)).toBe(true);
    const t2 = await setup();
    vi.setSystemTime(now + windowMs - 5);
    expect(await reserveAt(t2, { ...args(), issuedAt: now + windowMs + 5 })).toBe(true);
    expect((await state(t2)).counters.every(r => r.bucket === bucket)).toBe(true);
  });

  it("retains future-issued receipts through inclusive age60s, deleting only after expiry", async () => {
    const t = await setup(), future = { ...args(), issuedAt: now + 10000 };
    expect(await reserveAt(t, future)).toBe(true);
    for (const elapsed of [60001, 70000, 70001]) {
      vi.setSystemTime(now + elapsed);
      expect(await reserveAt(t, args(7, elapsed))).toBe(true);
      expect(await reserveAt(t, future)).toBe(false);
      expect((await state(t)).nonces.some(n => n.nonce === future.nonce)).toBe(true);
    }
    vi.setSystemTime(now + 70002);
    expect(await reserveAt(t, args(7, 70002))).toBe(true);
    expect((await state(t)).nonces.some(n => n.nonce === future.nonce)).toBe(false);
  });
});

describe("isolated bounded expiry maintenance", () => {
  async function securityRows(t: Test, partition: number | undefined, count: number, tag: string, expiresAt = now - 1) {
    return t.run(async ctx => {
      for (let i = 0; i < count; i++) {
        const fields = { expiresAt, ...(partition === undefined ? {} : { partition }) };
        await ctx.db.insert("gatewayNonces", { nonce: `${tag}-${i}`, ...fields });
        await ctx.db.insert("throttleCounters", { key: `${tag}-${i}`, bucket: bucket - 1, count: 1, ...fields });
      }
    });
  }
  it("deletes at most20 per table in the primary equality range, preserving other/live/legacy rows", async () => {
    const t = await setup();
    await securityRows(t, 7, 25, "selected"); await securityRows(t, 8, 2, "other");
    await securityRows(t, undefined, 2, "legacy"); await securityRows(t, 7, 2, "live", now + 101);
    await securityRows(t, 7, 2, "equal", now + 100);
    await fillBroad(t, "ip", 7); // Choosing fallback does not change cleanup range.
    vi.setSystemTime(now + 100);
    const { result, reads } = await tracedReserve(t);
    expect(result).toBe(true);
    const ranges = reads.filter(r => r.index === "by_partition_expiry");
    expect(ranges).toHaveLength(2);
    for (const r of ranges) { expect(r.take).toBe(20); expect(r.bounds).toEqual([["eq", "partition", 7], ["lt", "expiresAt", now + 100]]); }
    const after = await state(t);
    for (const rows of [after.nonces.map(n => n.nonce), after.counters.map(c => c.key)]) {
      expect(rows.filter(k => k.startsWith("selected-"))).toHaveLength(5);
      for (const tag of ["other", "legacy", "live", "equal"]) expect(rows.filter(k => k.startsWith(tag + "-"))).toHaveLength(2);
    }
  });

  it("preserves existing partitions and assigns legacy broad/exact counters consistently", async () => {
    const t = await setup();
    const ip = await seedCounter(t, partitionKey(ipBase, 7), 1);
    const identity = await seedCounter(t, identityKey, 1, 42);
    expect(await reserveAt(t)).toBe(true);
    expect(await t.run(ctx => ctx.db.get(ip))).toMatchObject({ partition: 7, count: 2 });
    expect(await t.run(ctx => ctx.db.get(identity))).toMatchObject({ partition: 42, count: 2 });
    expect(await reserveAt(t, args(8, 2))).toBe(true);
    expect(await t.run(ctx => ctx.db.get(identity))).toMatchObject({ partition: 42, count: 3 });
    const t2 = await setup(); const legacy = await seedCounter(t2, identityKey, 1);
    expect(await reserveAt(t2)).toBe(true);
    expect(await reserveAt(t2, args(9, 2))).toBe(true);
    expect(await t2.run(ctx => ctx.db.get(legacy))).toMatchObject({ partition: 7, count: 3 });
  });


  it.each([undefined, 0, 63])("admin maintenance uses only equality partition %j and strict present-time expiry", async partition => {
    const t = await setup();
    await securityRows(t, partition, 1, "expired");
    await securityRows(t, partition, 1, "equal", now + 100);
    await securityRows(t, partition === 63 ? 0 : 63, 1, "other");
    vi.setSystemTime(now + 100);
    const { result, reads } = await tracedSecurityMutation(t, pruneSecurity, { fingerprint, partition });
    expect(result).toEqual({ noncesDeleted: 1, countersDeleted: 1, more: false });
    expect(reads).toHaveLength(2);
    for (const r of reads) {
      expect(r.index).toBe("by_partition_expiry");
      expect(r.bounds).toEqual([["eq", "partition", partition], ["lt", "expiresAt", now + 100]]);
      expect(r.take).toBeLessThanOrEqual(101);
    }
    const after = await state(t);
    expect(after.nonces.map(n => n.nonce).sort()).toEqual(["equal-0", "other-0"]);
    expect(after.counters.map(c => c.key).sort()).toEqual(["equal-0", "other-0"]);
  });

  it("drains legacy and selected partitions separately, at most100 total deletes per call", async () => {
    const t = await setup();
    await securityRows(t, undefined, 125, "legacy"); await securityRows(t, 7, 125, "selected");
    await securityRows(t, 8, 2, "other"); await securityRows(t, 7, 2, "live-selected", now + 100000);
    await securityRows(t, undefined, 2, "live-legacy", now + 100000);
    for (const partition of [undefined, 7]) {
      let total = 0, more = true;
      for (let batch = 0; batch < 3; batch++) {
        const result = await t.mutation(ref("operations:pruneSecurity"), { fingerprint, ...(partition === undefined ? {} : { partition }) });
        expect(Object.keys(result).sort()).toEqual(["countersDeleted", "more", "noncesDeleted"]);
        const deleted = result.noncesDeleted + result.countersDeleted;
        expect(deleted).toBeLessThanOrEqual(100); total += deleted; more = result.more;
        expect(more).toBe(batch < 2);
      }
      expect(total).toBe(250); expect(more).toBe(false);
    }
    const after = await state(t);
    expect(after.nonces).toHaveLength(6); expect(after.counters).toHaveLength(6);
    const before = await state(t);
    for (const partition of [-1, 64, 0.5])
      await expect(t.mutation(ref("operations:pruneSecurity"), { fingerprint, partition })).rejects.toThrow("operations_invalid_partition");
    await expect(t.mutation(ref("operations:pruneSecurity"), { fingerprint: "f".repeat(64), partition: 8 })).rejects.toThrow("operations_dataset_mismatch");
    await expect(t.mutation(ref("operations:pruneSecurity"), { fingerprint, partition: 8, cutoff: now + 999999 })).rejects.toThrow();
    expect(await state(t)).toEqual(before);
  });
});

const payload = { legacyId, identity: "Student 1" };
const httpRequest = (body: unknown) => new Request("https://test.convex.site/gateway/checkin", {
  method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
});
async function invokeGateway(body: unknown, ctx = { runMutation: vi.fn(), runQuery: vi.fn() }, operation = checkin) {
  return { response: await (operation as any)._handler(ctx, httpRequest(body)), ctx };
}
async function signed(value = payload, issuedAt = now, proofNonce = nonce(7)) {
  return { payload: value, proof: await signGatewayRequest("checkin", value, { secret, audience, ipHash, now: issuedAt, nonce: proofNonce }) };
}
describe("gateway parsing, proof binding and server errors", () => {
  it.each(["{", "null", "[]", "1", '"text"', {}, { proof: {} }, { payload, extra: true },
    { payload: null }, { payload: [] }, { payload: { ...payload, extra: true } },
    { payload: { ...payload, identity: " " } }, { payload: { ...payload, legacyId: 1 } },
  ])("returns static400 for malformed JSON/envelope/payload %j without DB work", async body => {
    const { response, ctx } = await invokeGateway(body);
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: "Invalid request." });
    expect(ctx.runMutation).not.toHaveBeenCalled(); expect(ctx.runQuery).not.toHaveBeenCalled();
  });
  it.each([undefined, null, [], {}, { nonce: "a".repeat(32) }])("returns403 for missing/invalid proof %j before DB work", async proof => {
    const { response, ctx } = await invokeGateway({ payload, ...(proof === undefined ? {} : { proof }) });
    expect(response.status).toBe(403); expect(await response.json()).toEqual({ error: "Unauthorized." });
    expect(ctx.runMutation).not.toHaveBeenCalled(); expect(ctx.runQuery).not.toHaveBeenCalled();
  });
  it("binds payload, operation, age and nonce before all storage work", async () => {
    const valid = await signed();
    const variants = [
      { ...valid, payload: { ...payload, identity: "Student 2" } },
      { ...valid, proof: { ...valid.proof, nonce: nonce(8) } },
      await signed(payload, now - 60001), await signed(payload, now + 10001),
    ];
    for (const body of variants) {
      const { response, ctx } = await invokeGateway(body);
      expect(response.status).toBe(403); expect(ctx.runMutation).not.toHaveBeenCalled();
    }
    const publicPayload = { legacyId };
    const wrongOperation = await signed(publicPayload as any);
    const { response, ctx } = await invokeGateway(wrongOperation, undefined, publicInfo);
    expect(response.status).toBe(403); expect(ctx.runQuery).not.toHaveBeenCalled();
  });
  it.each([400, 403, 404, 409, 503])("preserves domain status %i with static bounded messages", async status => {
    const ctx = { runMutation: vi.fn().mockRejectedValue({ data: { status, message: "private-transaction-details" } }), runQuery: vi.fn() };
    const { response } = await invokeGateway(await signed(), ctx);
    expect(response.status).toBe(status);
    const body = await response.json(); expect(body.error).not.toContain("private"); expect(body.error.length).toBeLessThan(200);
  });
  it.each([new Error("OCC conflict details"), new Error("internal failure"), { data: { status: 500, message: "private" } }])(
    "maps unexpected server failures to static503", async failure => {
      const ctx = { runMutation: vi.fn().mockRejectedValue(failure), runQuery: vi.fn() };
      const { response } = await invokeGateway(await signed(), ctx);
      expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "Attendance is temporarily unavailable." });
      expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    },
  );
  it("preserves the static no-match validation message", async () => {
    const message = "No unique match found. Use your student ID or ask your teacher to check the roster.";
    const ctx = { runMutation: vi.fn().mockRejectedValue({ data: { status: 400, message } }), runQuery: vi.fn() };
    const { response } = await invokeGateway(await signed(), ctx);
    expect(await response.json()).toEqual({ error: message });
  });

  it("retains nonce/permits after downstream attendance failure; fresh submission can succeed", async () => {
    const t = await setup();
    await t.run(async ctx => {
      const classId = await ctx.db.insert("classes", { legacyId: "e".repeat(32), ownerKey: "f".repeat(64), title: "Test", createdAt: new Date(now).toISOString() });
      const versionId = await ctx.db.insert("rosterVersions", { classId, sourceKey: "test", digest: "test", count: 1 });
      await ctx.db.insert("rosterMembers", { versionId, studentId: "1".repeat(32), name: "Student 1", code: "1", normalizedName: "student 1", normalizedCode: "1", ordinal: 0 });
      await ctx.db.insert("sessions", { classId, rosterVersionId: versionId, legacyId, title: "Test", count: 1, bucketSize: 100, createdAt: new Date(now).toISOString() });
    });
    let failAttendance = true;
    const ctx = { runMutation: vi.fn(async (fn: any, a: any) => {
      // Actual reserve transaction commits independently before attendance.
      const name = getFunctionName(fn);
      if (name === "attendance:publicCheckin" && failAttendance) throw new Error("forced attendance OCC");
      return t.mutation(fn, a);
    }), runQuery: vi.fn() };
    const body = await signed();
    const failed = await invokeGateway(body, ctx);
    expect(failed.response.status).toBe(503);
    const retained = await state(t);
    expect(retained.nonces).toHaveLength(1); expect(retained.counters.map(c => c.count)).toEqual([1, 1, 1]);
    expect(retained.counters.some(c => c.key === `student:${ipHash}:${sha256(legacyId + ":student 1")}`)).toBe(true);
    expect(await t.run(c => c.db.query("attendance").collect())).toEqual([]);
    expect((await invokeGateway(body, ctx)).response.status).toBe(429);
    expect(await state(t)).toEqual(retained);
    failAttendance = false;
    const fresh = await invokeGateway(await signed(payload, now, nonce(7, 2)), ctx);
    expect(fresh.response.status).toBe(200); expect(await fresh.response.json()).toEqual({ name: "Student 1" });
    expect((await state(t)).nonces).toHaveLength(2);
    expect((await state(t)).counters.map(c => c.count)).toEqual([2, 2, 2]);
    expect(await t.run(c => c.db.query("attendance").collect())).toHaveLength(1);
  });
});
