import { internalMutation, internalQuery } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { requireReady } from "./access";
import { SESSION_DURATION_MS } from "../lib/auth-session-policy";
import {
  ADMISSION_WINDOW_MS,
  broadAllowance,
  counterAllowance,
  noncePartitions,
  type Allowance,
} from "./admission";

const cleanup = makeFunctionReference<"mutation">(
  "authSupport:cleanupSession",
) as any;
export const reserve = internalMutation({
  args: {
    nonce: v.string(),
    issuedAt: v.number(),
    ipHash: v.string(),
    username: v.optional(v.string()),
    operation: v.string(),
    sessionLegacyId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await requireReady(ctx, true);
    const now = Date.now();
    if (
      !["login", "signup", "checkin"].includes(a.operation) ||
      !/^[a-f0-9]{32}$/.test(a.nonce) ||
      !/^[a-f0-9]{64}$/.test(a.ipHash) ||
      !Number.isSafeInteger(a.issuedAt) ||
      a.issuedAt > now + 10000 ||
      now - a.issuedAt > 60000 ||
      (a.operation === "checkin"
        ? !/^[a-f0-9]{32}$/.test(a.sessionLegacyId ?? "") ||
          !/^[a-f0-9]{64}$/.test(a.username ?? "")
        : !/^[a-z0-9._-]{3,40}$/.test(a.username ?? ""))
    )
      return false;
    if (
      await ctx.db
        .query("gatewayNonces")
        .withIndex("by_nonce", (q) => q.eq("nonce", a.nonce))
        .unique()
    )
      return false;
    // Fixed receiver-time windows, independent of proof issuance time. This is
    // not a rolling limit. A live upgrade must retain consumed capacity/nonces,
    // or keep admission frozen until the existing bucket ends.
    const bucket = Math.floor(now / ADMISSION_WINDOW_MS);
    const { primary, alternate } = noncePartitions(a.nonce);
    const allowances: Allowance[] = [];
    let quotaPartitions: number | undefined;
    if (a.operation === "checkin") {
      const ip = await broadAllowance(
        ctx, `student-ip:${a.ipHash}`, bucket, "ip", primary, alternate,
      );
      if (!ip) return false;
      const session = await broadAllowance(
        ctx, `student-session:${a.ipHash}:${a.sessionLegacyId}`,
        bucket, "session", primary, alternate,
      );
      if (!session) return false;
      const identity = await counterAllowance(
        ctx, `student:${a.ipHash}:${a.username}`, bucket, 12, primary,
      );
      if (!identity) return false;
      allowances.push(ip, session, identity);
      quotaPartitions = ip.partition * 64 + session.partition;
    } else {
      for (const [key, capacity] of [
        [`auth-ip:${a.ipHash}`, 40],
        [`auth-user:${a.username}`, 12],
      ] as const) {
        const allowance = await counterAllowance(ctx, key, bucket, capacity, primary);
        if (!allowance) return false;
        allowances.push(allowance);
      }
    }
    // All allowances passed. Rejections above perform no writes or cleanup.
    await ctx.db.insert("gatewayNonces", {
      nonce: a.nonce,
      expiresAt: a.issuedAt + 60001,
      partition: primary,
      // Bounded benchmark diagnostics on the existing receipt, never used for
      // authorization. Adds one numeric field's bytes, no document/write; retain
      // through the nonce's ordinary expiry so actual fallback use is measurable.
      ...(quotaPartitions === undefined ? {} : { quotaPartitions }),
    });
    for (const { key, row, partition } of allowances) {
      // Broad counters start in their chosen quota partition. Exact identity
      // and credential counters start in the first admitting nonce's primary.
      // Existing assignments never move; legacy rows initialize on first patch.
      if (row)
        await ctx.db.patch(row._id, {
          count: row.count + 1,
          partition: row.partition ?? partition,
        });
      else
        await ctx.db.insert("throttleCounters", {
          key,
          bucket,
          count: 1,
          expiresAt: (bucket + 1) * ADMISSION_WINDOW_MS,
          partition,
        });
    }
    for (const row of await ctx.db
      .query("gatewayNonces")
      .withIndex("by_partition_expiry", (q) =>
        q.eq("partition", primary).lt("expiresAt", now),
      )
      .take(20))
      await ctx.db.delete(row._id);
    for (const row of await ctx.db
      .query("throttleCounters")
      .withIndex("by_partition_expiry", (q) =>
        q.eq("partition", primary).lt("expiresAt", now),
      )
      .take(20))
      await ctx.db.delete(row._id);
    return true;
  },
});
export const credential = internalQuery({
  args: { username: v.string() },
  handler: async (ctx, a) => {
    await requireReady(ctx);
    return ctx.db
      .query("credentials")
      .withIndex("by_username", (q) => q.eq("username", a.username))
      .unique();
  },
});
export const createUser = internalMutation({
  args: {
    username: v.string(),
    salt: v.string(),
    passwordHash: v.string(),
    ownerKey: v.string(),
  },
  handler: async (ctx, a) => {
    await requireReady(ctx, true);
    if (
      !/^[a-z0-9._-]{3,40}$/.test(a.username) ||
      !/^[a-f0-9]{32}$/.test(a.salt) ||
      !/^[a-f0-9]{128}$/.test(a.passwordHash) ||
      !/^[a-f0-9]{64}$/.test(a.ownerKey)
    )
      throw new ConvexError({ status: 400, message: "Invalid account." });
    if (
      (await ctx.db
        .query("credentials")
        .withIndex("by_username", (q) => q.eq("username", a.username))
        .unique()) ||
      (await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", a.username))
        .unique()) ||
      (await ctx.db
        .query("ownerLinks")
        .withIndex("by_owner", (q) => q.eq("ownerKey", a.ownerKey))
        .unique())
    )
      throw new ConvexError({ status: 409, message: "Username unavailable." });
    const userId = await ctx.db.insert("users", {
      username: a.username,
      ownerKey: a.ownerKey,
    });
    await ctx.db.insert("credentials", {
      username: a.username,
      userId,
      salt: a.salt,
      passwordHash: a.passwordHash,
    });
    await ctx.db.insert("ownerLinks", { userId, ownerKey: a.ownerKey });
    return userId;
  },
});
export const createSession = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireReady(ctx, true);
    if (!(await ctx.db.get(userId))) throw new Error("Sign in failed.");
    const expirationTime = Date.now() + SESSION_DURATION_MS;
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime,
    });
    await ctx.scheduler.runAt(expirationTime, cleanup, { sessionId });
    return sessionId;
  },
});
export const cleanupSession = internalMutation({
  args: { sessionId: v.id("authSessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (session && session.expirationTime > Date.now()) return;
    if (session) await ctx.db.delete(sessionId);
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionIdAndParentRefreshTokenId", (q) =>
        q.eq("sessionId", sessionId),
      )
      .take(100);
    for (const token of tokens) await ctx.db.delete(token._id);
    if (tokens.length === 100)
      await ctx.scheduler.runAfter(0, cleanup, { sessionId });
  },
});

export const revokeSession = internalMutation({
  args: { userId: v.id("users"), sessionId: v.id("authSessions") },
  handler: async (ctx, { userId, sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return;
    if (session.userId !== userId)
      throw new ConvexError({ status: 403, message: "Invalid session." });
    await ctx.db.delete(sessionId);
    await ctx.scheduler.runAfter(0, cleanup, { sessionId });
  },
});

export const revokeFromRefresh = internalMutation({
  args: { refreshToken: v.string() },
  handler: async (ctx, { refreshToken }) => {
    const parts = refreshToken.split("|");
    if (parts.length !== 2 || refreshToken.length > 512) return false;
    const tokenId = ctx.db.normalizeId("authRefreshTokens", parts[0]);
    const sessionId = ctx.db.normalizeId("authSessions", parts[1]);
    if (!tokenId || !sessionId) return false;
    const token = await ctx.db.get(tokenId);
    if (!token) return (await ctx.db.get(sessionId)) === null;
    if (token.sessionId !== sessionId) return false;
    // A previously issued capability can only LOCK this same session. It never
    // grants data or issues tokens; old rotation state is not a minting grant.
    const session = await ctx.db.get(sessionId);
    if (session) {
      await ctx.db.delete(sessionId);
      await ctx.scheduler.runAfter(0, cleanup, { sessionId });
    }
    return true;
  },
});
