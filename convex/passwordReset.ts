"use node";
import { internalAction } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { createHash, randomBytes } from "node:crypto";
import { legacyPasswordHash } from "../lib/legacy-password.mjs";
import { verifyGatewayRequest } from "../lib/gateway-proof.mjs";

const ref = (name: string) =>
  makeFunctionReference<any>(`authSupport:${name}`) as any;
const DEFAULT_BASE_URL = "https://attend.nosanosa.me";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

// Admin-only internal action (invoked via `convex run passwordReset:createResetLink`).
// Never exposed to browsers; generates a single-use token and stores only its SHA-256 hash.
export const createResetLink = internalAction({
  args: {
    username: v.string(),
    baseUrl: v.optional(v.string()),
    ttlMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    url: string;
    username: string;
    expiresAt: number;
    expiresAtIso: string;
  }> => {
    const username = args.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) {
      throw new ConvexError({ status: 400, message: "Invalid username." });
    }
    const ttlMinutes = Math.min(
      1440,
      Math.max(5, Math.floor(args.ttlMinutes ?? 30)),
    );
    let base: URL;
    try {
      base = new URL(args.baseUrl ?? DEFAULT_BASE_URL);
      if (!["http:", "https:"].includes(base.protocol)) {
        throw new Error("Invalid protocol.");
      }
    } catch {
      throw new ConvexError({ status: 400, message: "Invalid base URL." });
    }
    const token = randomBytes(32).toString("base64url");
    const tokenHash = sha256Hex(token);
    const expiresAt = Date.now() + ttlMinutes * 60_000;
    await ctx.runMutation(ref("storePasswordReset"), {
      username,
      tokenHash,
      expiresAt,
    });
    const url = `${base.origin}/?reset=${encodeURIComponent(token)}`;
    return {
      url,
      username,
      expiresAt,
      expiresAtIso: new Date(expiresAt).toISOString(),
    };
  },
});

export const completeResetNode = internalAction({
  args: {
    token: v.string(),
    password: v.string(),
    proof: v.any(),
  },
  handler: async (ctx, a): Promise<{ ok: boolean; username: string }> => {
    if (
      !TOKEN_PATTERN.test(a.token) ||
      a.password.length < 10 ||
      a.password.length > 128
    ) {
      throw new ConvexError({
        status: 400,
        message: "Use a password of 10–128 characters.",
      });
    }
    const payload = { token: a.token, password: a.password };
    if (
      !(await verifyGatewayRequest("password-reset", payload, a.proof, {
        secret: process.env.ATTENDANCE_GATEWAY_KEY,
        audience: process.env.ATTENDANCE_GATEWAY_AUDIENCE,
      }))
    ) {
      throw new ConvexError({ status: 403, message: "Unauthorized." });
    }
    const tokenHash = sha256Hex(a.token);
    if (
      !(await ctx.runMutation(ref("reserve"), {
        nonce: a.proof.nonce,
        issuedAt: a.proof.issuedAt,
        ipHash: a.proof.ipHash,
        username: tokenHash,
        operation: "password-reset",
      }))
    ) {
      throw new ConvexError({
        status: 429,
        message: "Too many attempts. Please try again later.",
      });
    }
    const salt = randomBytes(16).toString("hex");
    const passwordHash = await legacyPasswordHash(a.password, salt);
    return await ctx.runMutation(ref("consumePasswordReset"), {
      tokenHash,
      salt,
      passwordHash,
    });
  },
});
