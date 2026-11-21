/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { createHash } from "node:crypto";
import schema from "../../convex/schema";
import { hashGatewayIp, signGatewayRequest } from "../../lib/gateway-proof.mjs";
import { safeAuthErrorMessage } from "../../lib/convex-auth-errors.mjs";

const modules = import.meta.glob("../../convex/**/*.ts");
const ref = (name: string) => makeFunctionReference<any>(name) as any;
const secret = "synthetic-private-gateway-key-for-tests-only";
const audience = "attendance-tests";
const now = 1_800_000_000_000;
const ipHash = await hashGatewayIp("192.0.2.9");
const counts = {
  accounts: 0,
  legacyClaims: 0,
  classes: 0,
  rosterVersions: 0,
  rosterMembers: 0,
  memberships: 0,
  sessions: 0,
  closures: 0,
  attendance: 0,
};

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const run = await ctx.db.insert("migrationRuns", {
      fingerprint: "a".repeat(64),
      status: "active",
      exportedAt: new Date(now).toISOString(),
      expectedCounts: counts,
    });
    await ctx.db.insert("deploymentState", {
      key: "migration",
      activeRunId: run,
      readsEnabled: true,
      writesEnabled: true,
    });
  });
  return t;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now });
  vi.stubEnv("ATTENDANCE_GATEWAY_KEY", secret);
  vi.stubEnv("ATTENDANCE_GATEWAY_AUDIENCE", audience);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("safe auth error unwrapping", () => {
  it("surfaces allowlisted auth gateway messages from plain Errors", () => {
    expect(safeAuthErrorMessage(new Error("Incorrect username or password."))).toBe(
      "Incorrect username or password.",
    );
    expect(
      safeAuthErrorMessage(
        new Error("That username is unavailable. Sign in or choose another."),
      ),
    ).toBe("That username is unavailable. Sign in or choose another.");
    expect(
      safeAuthErrorMessage(new Error("Too many attempts. Please try again later.")),
    ).toBe("Too many attempts. Please try again later.");
  });

  it("hides unexpected or internal error messages", () => {
    expect(safeAuthErrorMessage(new Error("SQLite stack trace detail"))).toBeNull();
    expect(safeAuthErrorMessage("Incorrect username or password.")).toBeNull();
    expect(safeAuthErrorMessage(null)).toBeNull();
  });
});

describe("admin password reset links", () => {
  it("creates a single-use reset link, updates password, revokes sessions, and blocks reuse", async () => {
    const t = await setup();
    const username = "fola";
    const oldPassword = "old-password-1234";
    const newPassword = "new-password-5678";

    const signupProof = await signGatewayRequest(
      "signup",
      { username, password: oldPassword },
      { secret, audience, ipHash, now },
    );
    const created = await t.action(ref("password:authenticateNode"), {
      operation: "signup",
      username,
      password: oldPassword,
      proof: signupProof,
    });
    expect(created.userId).toBeTruthy();
    expect(created.sessionId).toBeTruthy();

    const link = await t.action(ref("passwordReset:createResetLink"), {
      username: "  FOLA ",
    });
    expect(link.username).toBe("fola");
    expect(link.url).toMatch(/^https:\/\/attend\.nosanosa\.me\/\?reset=[A-Za-z0-9_-]{32,128}$/);
    const token = new URL(link.url).searchParams.get("reset")!;
    const tokenHash = createHash("sha256").update(token).digest("hex");

    // Stored record contains only the hash, never the raw token.
    const stored = await t.run((ctx) => ctx.db.query("passwordResets").collect());
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).toBe(tokenHash);

    const info = await t.query(ref("authSupport:passwordResetInfo"), { tokenHash });
    expect(info.username).toBe("fola");

    // Invalid gateway proof is rejected before touching credentials.
    await expect(
      t.action(ref("passwordReset:completeResetNode"), {
        token,
        password: newPassword,
        proof: {},
      }),
    ).rejects.toThrow();

    // Valid gateway proof updates the password and revokes prior sessions.
    const resetProof = await signGatewayRequest(
      "password-reset",
      { token, password: newPassword },
      { secret, audience, ipHash, now },
    );
    const result = await t.action(ref("passwordReset:completeResetNode"), {
      token,
      password: newPassword,
      proof: resetProof,
    });
    expect(result).toEqual({ ok: true, username: "fola" });
    expect(await t.run((ctx) => ctx.db.get(created.sessionId))).toBeNull();

    // Old password no longer works; new password signs in cleanly.
    const oldLogin = await t.action(ref("password:authenticateNode"), {
      operation: "login",
      username,
      password: oldPassword,
      proof: await signGatewayRequest(
        "login",
        { username, password: oldPassword },
        { secret, audience, ipHash, now },
      ),
    });
    expect(oldLogin).toBeNull();

    const newLogin = await t.action(ref("password:authenticateNode"), {
      operation: "login",
      username,
      password: newPassword,
      proof: await signGatewayRequest(
        "login",
        { username, password: newPassword },
        { secret, audience, ipHash, now },
      ),
    });
    expect(newLogin.userId).toBe(created.userId);

    // Token cannot be inspected or reused a second time.
    await expect(
      t.query(ref("authSupport:passwordResetInfo"), { tokenHash }),
    ).rejects.toThrow();
    await expect(
      t.action(ref("passwordReset:completeResetNode"), {
        token,
        password: "another-password-9999",
        proof: await signGatewayRequest(
          "password-reset",
          { token, password: "another-password-9999" },
          { secret, audience, ipHash, now },
        ),
      }),
    ).rejects.toThrow();
  });

  it("rejects expired reset tokens and replaces prior unused links for the same user", async () => {
    const t = await setup();
    const username = "teacher.reset";
    const password = "initial-password-123";
    await t.action(ref("password:authenticateNode"), {
      operation: "signup",
      username,
      password,
      proof: await signGatewayRequest(
        "signup",
        { username, password },
        { secret, audience, ipHash, now },
      ),
    });

    const first = await t.action(ref("passwordReset:createResetLink"), {
      username,
      ttlMinutes: 10,
    });
    const second = await t.action(ref("passwordReset:createResetLink"), {
      username,
      ttlMinutes: 10,
    });

    const firstToken = new URL(first.url).searchParams.get("reset")!;
    const secondToken = new URL(second.url).searchParams.get("reset")!;
    const firstHash = createHash("sha256").update(firstToken).digest("hex");
    const secondHash = createHash("sha256").update(secondToken).digest("hex");

    // Issuing a new link invalidates the older unused link.
    await expect(
      t.query(ref("authSupport:passwordResetInfo"), { tokenHash: firstHash }),
    ).rejects.toThrow();
    expect(
      (await t.query(ref("authSupport:passwordResetInfo"), { tokenHash: secondHash }))
        .username,
    ).toBe(username);

    // Advancing past expiry rejects the token.
    vi.setSystemTime(now + 11 * 60_000);
    await expect(
      t.query(ref("authSupport:passwordResetInfo"), { tokenHash: secondHash }),
    ).rejects.toThrow();
  });
});
