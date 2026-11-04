/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { NextRequest } from "next/server";
import schema from "../../convex/schema";
import { hashGatewayIp, signGatewayRequest, verifyGatewayRequest } from "../../lib/gateway-proof.mjs";
import { handleConvexAuth } from "../../lib/convex-auth-handler";
import { trustedIp } from "../../lib/convex-auth-gateway";
import { sessionClaims, JWT_DURATION_MS, JWT_EXPIRY_MARGIN_MS } from "../../lib/auth-session-policy";
import { verifiedLogout } from "../../lib/convex-logout.mjs";

const modules = import.meta.glob("../../convex/**/*.ts");
const ref = (name: string) => makeFunctionReference<any>(name) as any;
const secret = "synthetic-private-gateway-key-for-tests-only";
const audience = "attendance-tests";
const now = 1_800_000_000_000;
const ipHash = await hashGatewayIp("192.0.2.1");
const counts = { accounts: 0, legacyClaims: 0, classes: 0, rosterVersions: 0, rosterMembers: 0,
  memberships: 0, sessions: 0, closures: 0, attendance: 0 };

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    const run = await ctx.db.insert("migrationRuns", { fingerprint: "a".repeat(64), status: "active",
      exportedAt: new Date(now).toISOString(), expectedCounts: counts });
    await ctx.db.insert("deploymentState", { key: "migration", activeRunId: run, readsEnabled: true, writesEnabled: true });
  });
  return t;
}
const reservation = (i: number, username = "teacher") => ({ nonce: i.toString(16).padStart(32, "0"), issuedAt: now,
  ipHash, username, operation: "login" });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now });
  vi.stubEnv("ATTENDANCE_GATEWAY_KEY", secret); vi.stubEnv("ATTENDANCE_GATEWAY_AUDIENCE", audience);
  vi.stubEnv("VERCEL", "1");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("gateway admission transactions", () => {
  it("consumes each proof once and rejects expired/future reservations without writes", async () => {
    const t = await setup();
    expect(await t.mutation(ref("authSupport:reserve"), reservation(1))).toBe(true);
    const before = await t.run(async ctx => ({ nonces: await ctx.db.query("gatewayNonces").collect(), counters: await ctx.db.query("throttleCounters").collect() }));
    expect(await t.mutation(ref("authSupport:reserve"), reservation(1))).toBe(false);
    expect(await t.mutation(ref("authSupport:reserve"), { ...reservation(2), issuedAt: now - 60001 })).toBe(false);
    expect(await t.mutation(ref("authSupport:reserve"), { ...reservation(3), issuedAt: now + 20000 })).toBe(false);
    expect(await t.run(async ctx => ({ nonces: await ctx.db.query("gatewayNonces").collect(), counters: await ctx.db.query("throttleCounters").collect() }))).toEqual(before);
  });
  it("enforces username and trusted-IP limits; rejected retries do not keep writing", async () => {
    const t = await setup();
    for (let i = 0; i < 12; i++) expect(await t.mutation(ref("authSupport:reserve"), reservation(i + 1))).toBe(true);
    const before = await t.run(ctx => ctx.db.query("throttleCounters").collect());
    expect(await t.mutation(ref("authSupport:reserve"), reservation(13))).toBe(false);
    expect(await t.mutation(ref("authSupport:reserve"), reservation(14))).toBe(false);
    expect(await t.run(ctx => ctx.db.query("throttleCounters").collect())).toEqual(before);
    for (let i = 12; i < 40; i++) expect(await t.mutation(ref("authSupport:reserve"), reservation(100 + i, `teacher${i}`))).toBe(true);
    expect(await t.mutation(ref("authSupport:reserve"), reservation(500, "anotherteacher"))).toBe(false);
  });
  it("admits 1,000 distinct students behind one school IP using separate check-in limits", async () => {
    const t = await setup();
    for (let i = 0; i < 1000; i++) expect(await t.mutation(ref("authSupport:reserve"), {
      ...reservation(i + 1, i.toString(16).padStart(64, "0")), operation: "checkin", sessionLegacyId: "b".repeat(32),
    })).toBe(true);
  }, 60_000);
  it("keeps a future-clock proof's nonce throughout the complete accepted window", async () => {
    const t = await setup(), args = { ...reservation(1), issuedAt: now + 10000 };
    expect(await t.mutation(ref("authSupport:reserve"), args)).toBe(true);
    vi.setSystemTime(now + 70000);
    expect(await t.mutation(ref("authSupport:reserve"), args)).toBe(false);
    expect(await t.run(ctx => ctx.db.query("gatewayNonces").collect())).toHaveLength(1);
  });
  it("requires an active verified deployment before creating any security state", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(ref("authSupport:reserve"), reservation(1))).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.query("gatewayNonces").collect())).toEqual([]);
  });
});

describe("private password flow", () => {
  it("preserves username-only signup and exact passwords, and does not replay a credential proof", async () => {
    const t = await setup(), username = "teacher-name", password = "  exact password  ";
    const proof = await signGatewayRequest("signup", { username, password }, { secret, audience, ipHash, now });
    const args = { operation: "signup", username, password, proof };
    const created = await t.action(ref("password:authenticateNode"), args);
    expect(created.userId).toBeTruthy();
    await expect(t.action(ref("password:authenticateNode"), args)).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.query("users").collect())).toHaveLength(1);
    const login = async (value: string) => t.action(ref("password:authenticateNode"), {
      operation: "login", username, password: value,
      proof: await signGatewayRequest("login", { username, password: value }, { secret, audience, ipHash, now }),
    });
    expect(await login(password.trim())).toBeNull();
    expect((await login(password)).userId).toBe(created.userId);
    const duplicate = { ...args, proof: await signGatewayRequest("signup", { username, password }, { secret, audience, ipHash, now }) };
    await expect(t.action(ref("password:authenticateNode"), duplicate)).rejects.toThrow();
    expect(await t.run(ctx => ctx.db.query("credentials").collect())).toHaveLength(1);
  });
  it("revokes an expired session before removing refresh tokens in bounded batches", async () => {
    const t = await setup();
    const sessionId = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { username: "teacher" });
      const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: now - 1 });
      for (let i = 0; i < 105; i++) await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: now + 10000 });
      return sessionId;
    });
    await t.mutation(ref("authSupport:cleanupSession"), { sessionId });
    expect(await t.run(ctx => ctx.db.get(sessionId))).toBeNull();
    expect(await t.run(ctx => ctx.db.query("authRefreshTokens").collect())).toHaveLength(5);
    await t.mutation(ref("authSupport:cleanupSession"), { sessionId });
    expect(await t.run(ctx => ctx.db.query("authRefreshTokens").collect())).toEqual([]);
  });
});

describe("token issuance policy", () => {
  it("rejects tokens that could outlive the fixed session and never extends the deadline", async () => {
    const userId = "user", sessionId = "session";
    let expirationTime = now + JWT_DURATION_MS + JWT_EXPIRY_MARGIN_MS;
    const ctx = { db: { get: async (id: string) => id === userId ? { _id: userId } : { userId, expirationTime } } };
    expect(await sessionClaims(ctx, { userId, sessionId }, now)).toEqual({ sessionExpiresAt: expirationTime });
    expirationTime--;
    await expect(sessionClaims(ctx, { userId, sessionId }, now)).rejects.toThrow();
    await expect(sessionClaims(ctx, { userId: "wrong-user", sessionId }, now)).rejects.toThrow();
  });
});

const jwt = (deadline: number) => `header.${Buffer.from(JSON.stringify({ sessionExpiresAt: deadline })).toString("base64url")}.signature`;
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("https://app.example/api/convex-auth", { method: "POST", headers: {
    origin: "https://app.example", "content-type": "application/json", "x-vercel-forwarded-for": "192.0.2.1", ...headers,
  }, body: JSON.stringify(body) });
}
describe("Next cookie and error adapter", () => {
  it("does not attach an old or expired cookie to an independent credential sign-in", async () => {
    const token = jwt(now + 86400000);
    const invoke = vi.fn(async (_action: string, _args: Record<string, unknown>, oldToken?: string) => {
      if (oldToken) throw new Error("Expired bearer token");
      return { tokens: { token, refreshToken: "fresh-refresh-token" } };
    });
    const response = await handleConvexAuth(request({ action: "auth:signIn", args: { provider: "credentials", params: {
      operation: "login", username: "teacher", password: "long-password",
    } } }, { cookie: "__Host-__convexAuthJWT=expired-bearer" }), invoke);
    expect(response.status).toBe(200);
    expect(invoke.mock.calls[0][2]).toBeUndefined();
  });
  it("logs out near the deadline using the current token without refreshing it", async () => {
    const invoke = vi.fn(async (action: string) => {
      if (action === "auth:signIn") throw new Error("New JWT issuance rejected near deadline");
    });
    const response = await handleConvexAuth(request({ action: "auth:signOut" }, {
      cookie: "__Host-__convexAuthJWT=existing-access; __Host-__convexAuthRefreshToken=existing-refresh",
    }), invoke);
    expect(response.status).toBe(200);
    expect(invoke.mock.calls).toHaveLength(1);
    expect(invoke.mock.calls[0][0]).toBe("auth:signOut");
    expect(response.headers.getSetCookie()).toHaveLength(3);
  });
  it("falls back from an expired JWT to proof-bound refresh-capability revocation without new JWT issuance", async () => {
    const invoke = vi.fn(async (action: string, args: Record<string, unknown>, token?: string) => {
      expect(action).toBe("auth:signOut");
      if (token) throw { data: { status: 401 } };
      expect(args.refreshToken).toBe("existing-refresh");
      expect(await verifyGatewayRequest("logout", { refreshToken: args.refreshToken }, args.proof, { secret, audience, now })).toBe(true);
    });
    const response = await handleConvexAuth(request({ action: "auth:signOut" }, {
      cookie: "__Host-__convexAuthJWT=expired-access; __Host-__convexAuthRefreshToken=existing-refresh",
    }), invoke);
    expect(response.status).toBe(200);
    expect(invoke.mock.calls).toHaveLength(2);
    expect(response.headers.getSetCookie()).toHaveLength(3);
  });
  it("does not clear cookies or present successful logout if server revocation fails", async () => {
    const failed = await handleConvexAuth(request({ action: "auth:signOut" }, {
      cookie: "__Host-__convexAuthJWT=access; __Host-__convexAuthRefreshToken=refresh",
    }), async () => { throw new Error("Network unavailable"); });
    expect(failed.status).toBe(503); expect(failed.headers.getSetCookie()).toEqual([]);
    const navigate = vi.fn();
    await expect(verifiedLogout({ fetcher: async () => new Response("", { status: 503 }), navigate })).rejects.toThrow("Unable to sign out");
    expect(navigate).not.toHaveBeenCalled();
  });
  it("clears expired refresh state so the maintained client can return to credential sign-in", async () => {
    const response = await handleConvexAuth(request({ action: "auth:signIn", args: { refreshToken: "dummy" } }, {
      cookie: "__Host-__convexAuthRefreshToken=expired-refresh",
    }), async () => { throw { data: { status: 401 } }; });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ tokens: null });
    expect(response.headers.getSetCookie()).toHaveLength(3);
  });
  it("matches the pinned provider on supported local hosts and refuses insecure unsupported origins", async () => {
    vi.stubEnv("VERCEL", ""); vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "http://127.0.0.1:3210");
    for (const host of ["localhost:3000", "127.0.0.1:3000"]) {
      const req = new NextRequest(`http://${host}/api/convex-auth`, { method: "POST", headers: { host }, body: JSON.stringify({ action: "auth:signOut" }) });
      const response = await handleConvexAuth(req);
      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie().join(";")).toContain("__convexAuthJWT=");
      expect(response.headers.getSetCookie().join(";")).not.toContain("__Host-");
    }
    for (const host of ["localhost", "[::1]:3000"]) {
      const req = new NextRequest(`http://${host}/api/convex-auth`, { method: "POST", headers: { host }, body: JSON.stringify({ action: "auth:signOut" }) });
      expect((await handleConvexAuth(req)).status).toBe(503);
    }
  });
  it("keeps refresh capabilities HttpOnly and out of responses; cookies keep their fixed deadline", async () => {
    const token = jwt(now + 10 * 86400000), refreshToken = "private-refresh-capability";
    const invoke = vi.fn(async (_action: string, _args: Record<string, unknown>, _token?: string) => ({ tokens: { token, refreshToken } }));
    const response = await handleConvexAuth(request({ action: "auth:signIn", args: { provider: "credentials", params: {
      operation: "login", username: " Teacher-Name ", password: "  password  ",
    } } }), invoke);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tokens: { token, refreshToken: "dummy" } });
    const cookies = response.headers.getSetCookie().join(";");
    expect(cookies).toContain("__Host-__convexAuthJWT"); expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("Secure"); expect(cookies).toContain("SameSite=lax");
    expect(cookies).toContain("Max-Age=864000");
    const params = invoke.mock.calls[0][1].params as any;
    expect(params.username).toBe("teacher-name"); expect(params.password).toBe("  password  ");
    expect(await verifyGatewayRequest("login", { username: params.username, password: params.password }, params.proof, { secret, audience, now })).toBe(true);
    vi.setSystemTime(now + 86400000);
    const refreshed = await handleConvexAuth(request({ action: "auth:signIn", args: { refreshToken: "dummy" } }, {
      cookie: "__Host-__convexAuthRefreshToken=private-refresh-capability",
    }), invoke);
    expect(refreshed.headers.getSetCookie().join(";")).toContain("Max-Age=777600");
    expect(invoke.mock.calls.at(-1)?.[1]).toEqual({ refreshToken });
  });
  it("returns conflict status and static failures without logging raw SDK details", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = { action: "auth:signIn", args: { provider: "credentials", params: {
      operation: "signup", username: "teacher", password: "long-password",
    } } };
    const conflict = await handleConvexAuth(request(body), async () => { throw { data: { status: 409 }, message: "secret password" }; });
    expect(conflict.status).toBe(409); expect(JSON.stringify(await conflict.json())).not.toContain("secret password");
    const failed = await handleConvexAuth(request(body), async () => { throw new Error("SDK token and password details"); });
    expect(failed.status).toBe(503); expect(JSON.stringify(await failed.json())).not.toContain("SDK token");
    expect(errorLog).not.toHaveBeenCalled();
  });
  it("rejects alternate flows, forged forwarding headers, wrong origins and oversized bodies before invoking Convex", async () => {
    const invoke = vi.fn();
    for (const body of [{ action: "auth:signIn", args: { params: { code: "123", email: "anything" } } },
      { action: "auth:signIn", args: { refreshToken: "browser-supplied-secret" } }]) {
      expect((await handleConvexAuth(request(body), invoke)).status).toBe(400);
    }
    expect((await handleConvexAuth(request({ action: "auth:signOut" }, { origin: "https://evil.example" }), invoke)).status).toBe(403);
    const noTrusted = request({}, { "x-forwarded-for": "192.0.2.99" }); noTrusted.headers.delete("x-vercel-forwarded-for");
    expect(() => trustedIp(noTrusted)).toThrow();
    expect((await handleConvexAuth(request({ action: "auth:signOut", extra: "x".repeat(5000) }), invoke)).status).toBe(413);
    expect(invoke).not.toHaveBeenCalled();
  });
  it("supports the maintained client's omitted sign-out args and clears cookies", async () => {
    const invoke = vi.fn(async () => ({}));
    const response = await handleConvexAuth(request({ action: "auth:signOut" }), invoke);
    expect(response.status).toBe(200); expect(response.headers.getSetCookie().join(";")).toContain("Expires=Thu, 01 Jan 1970");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("bounded logout revocation", () => {
  it("removes session authority without collecting a refresh chain larger than a transaction", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { userId, sessionId } = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { username: "teacher" });
      return { userId, sessionId: await ctx.db.insert("authSessions", { userId, expirationTime: now + 86400000 }) };
    });
    for (let batch = 0; batch < 17; batch++) await t.run(async ctx => {
      for (let i = 0; i < 1000; i++) await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: now + 86400000 });
    });
    await t.mutation(ref("authSupport:revokeSession"), { userId, sessionId });
    expect(await t.run(ctx => ctx.db.get(sessionId))).toBeNull();
    expect((await t.run(ctx => ctx.db.query("authRefreshTokens").take(101))).length).toBe(101);
  }, 60000);
  it("accepts an existing refresh capability only for revoking its own session", async () => {
    const t = await setup();
    const ids = await t.run(async ctx => {
      const userId = await ctx.db.insert("users", { username: "teacher" });
      const sessionId = await ctx.db.insert("authSessions", { userId, expirationTime: now + 30000 });
      const other = await ctx.db.insert("authSessions", { userId, expirationTime: now + 30000 });
      const refreshId = await ctx.db.insert("authRefreshTokens", { sessionId, expirationTime: now + 30000, firstUsedTime: now - 10000 });
      return { userId, sessionId, other, refreshId };
    });
    expect(await t.mutation(ref("authSupport:revokeFromRefresh"), { refreshToken: `${ids.refreshId}|${ids.other}` })).toBe(false);
    expect(await t.mutation(ref("authSupport:revokeFromRefresh"), { refreshToken: `${ids.refreshId}|${ids.sessionId}` })).toBe(true);
    expect(await t.run(ctx => ctx.db.get(ids.sessionId))).toBeNull();
    expect(await t.run(ctx => ctx.db.get(ids.other))).not.toBeNull();
  });
});
