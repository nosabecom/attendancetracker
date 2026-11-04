/// <reference types="vite/client" />
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";

const modules = import.meta.glob("../../convex/**/*.ts");
const store = makeFunctionReference<"mutation">("auth:store") as any;
const cleanup = makeFunctionReference<"mutation">(
  "authSupport:cleanupSession",
) as any;
const now = 1_800_000_000_000;
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { format: "pem", type: "pkcs8" },
  publicKeyEncoding: { format: "pem", type: "spki" },
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now });
  vi.stubEnv("JWT_PRIVATE_KEY", privateKey);
  vi.stubEnv("CONVEX_SITE_URL", "https://synthetic-test.convex.site");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function fixture() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      username: "refresh-fixture",
    });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: now + 86_400_000,
    });
    const otherSessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: now + 86_400_000,
    });
    const tokenId = await ctx.db.insert("authRefreshTokens", {
      sessionId,
      expirationTime: now + 86_400_000,
    });
    return { userId, sessionId, otherSessionId, tokenId };
  });
  const refresh = (tokenId: string, sessionId = ids.sessionId) =>
    t.mutation(store, {
      args: { type: "refreshSession", refreshToken: `${tokenId}|${sessionId}` },
    });
  return { t, ...ids, refresh };
}

async function seedLargeHistory(
  f: Awaited<ReturnType<typeof fixture>>,
  parent: Id<"authRefreshTokens">,
) {
  // Exceeds one transaction's document-read limit and includes a deep lineage.
  // Each setup transaction is deliberately bounded; refresh must not traverse it.
  let tip = parent;
  for (let batch = 0; batch < 17; batch++) {
    tip = await f.t.run(async (ctx) => {
      let previous = tip;
      for (let i = 0; i < 1000; i++)
        previous = await ctx.db.insert("authRefreshTokens", {
          sessionId: f.sessionId,
          expirationTime: now + 86_400_000,
          firstUsedTime: now - 20_000,
          parentRefreshTokenId: previous,
        });
      return previous;
    });
  }
  return tip;
}

describe("pinned managed refresh transaction", () => {
  it("rejects mismatched and deleted capabilities without changing either session or scheduling work", async () => {
    const f = await fixture();
    const before = await f.t.run(async (ctx) => ({
      sessions: await ctx.db.query("authSessions").collect(),
      tokens: await ctx.db.query("authRefreshTokens").collect(),
      jobs: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    expect(await f.refresh(f.tokenId, f.otherSessionId)).toBeNull();
    expect(
      await f.t.run(async (ctx) => ({
        sessions: await ctx.db.query("authSessions").collect(),
        tokens: await ctx.db.query("authRefreshTokens").collect(),
        jobs: await ctx.db.system.query("_scheduled_functions").collect(),
      })),
    ).toEqual(before);
    await f.t.run((ctx) => ctx.db.delete(f.tokenId));
    expect(await f.refresh(f.tokenId, f.otherSessionId)).toBeNull();
    expect(
      await f.t.run((ctx) => ctx.db.query("authSessions").collect()),
    ).toEqual(before.sessions);
    expect(
      await f.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      ),
    ).toEqual([]);
  });

  it("keeps managed JWT issuance, rotation and an immediate duplicate refresh compatible", async () => {
    const f = await fixture();
    const first = await f.refresh(f.tokenId);
    expect(first.token.split(".")).toHaveLength(3);
    expect(first.refreshToken).not.toBe(`${f.tokenId}|${f.sessionId}`);
    const duplicate = await f.refresh(f.tokenId);
    expect(duplicate.refreshToken).toBe(first.refreshToken);
    expect(
      await f.t.run((ctx) => ctx.db.query("authRefreshTokens").collect()),
    ).toHaveLength(2);
    const second = await f.refresh(first.refreshToken.split("|")[0]);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    const claims = JSON.parse(
      Buffer.from(second.token.split(".")[1], "base64url").toString(),
    );
    expect(claims.sub).toBe(`${f.userId}|${f.sessionId}`);
    expect(claims.sessionExpiresAt).toBe(now + 86_400_000);
  });

  it("revokes delayed replay with a history exceeding the transaction limit, then cleans only a bounded batch", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.patch(f.tokenId, { firstUsedTime: now - 20_000 }),
    );
    const tip = await seedLargeHistory(f, f.tokenId);
    // No unused token exists. A descending filtered scan must read the entire
    // 17,000-record history and exceed limits; the compound index reads none.
    expect(await f.refresh(f.tokenId)).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(f.sessionId))).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(f.otherSessionId))).not.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(tip))).not.toBeNull();
    await f.t.mutation(cleanup, { sessionId: f.sessionId });
    expect(
      await f.t.run((ctx) => ctx.db.query("authRefreshTokens").take(101)),
    ).toHaveLength(101);
    // Repeated presentations after revocation do not create more cleanup jobs.
    const jobs = await f.t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(await f.refresh(tip)).toBeNull();
    expect(
      await f.t.run((ctx) =>
        ctx.db.system.query("_scheduled_functions").collect(),
      ),
    ).toEqual(jobs);
  }, 60_000);

  it("expires only the proven capability's session without collecting a large chain", async () => {
    const f = await fixture();
    await seedLargeHistory(f, f.tokenId);
    await f.t.run((ctx) =>
      ctx.db.patch(f.tokenId, { expirationTime: now - 1 }),
    );
    expect(await f.refresh(f.tokenId)).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(f.sessionId))).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(f.otherSessionId))).not.toBeNull();
  }, 60_000);
});
