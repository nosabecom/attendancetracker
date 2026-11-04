import {
  convexAuth,
  getAuthSessionId,
  getAuthUserId,
} from "@convex-dev/auth/server";
import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import { action } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { verifyGatewayRequest } from "../lib/gateway-proof.mjs";
import {
  JWT_DURATION_MS,
  SESSION_DURATION_MS,
  sessionClaims,
} from "../lib/auth-session-policy";
const managed = convexAuth({
  providers: [
    ConvexCredentials({
      authorize: async (params, ctx) => {
        if (
          typeof params.operation !== "string" ||
          typeof params.username !== "string" ||
          typeof params.password !== "string" ||
          !params.proof
        )
          return null;
        return (await ctx.runAction(
          makeFunctionReference<"action">("password:authenticateNode") as any,
          params as any,
        )) as any;
      },
    }),
  ],
  session: {
    totalDurationMs: SESSION_DURATION_MS,
    inactiveDurationMs: SESSION_DURATION_MS,
  },
  jwt: { durationMs: JWT_DURATION_MS, customClaims: sessionClaims },
});
export const { auth, store, isAuthenticated } = managed;

// Revocation is intentionally independent of issuing a new JWT. The managed
// signOut deletes an unbounded refresh chain; ours removes authority first and
// schedules bounded cleanup while preserving the client's signOut protocol.
export const signOut = action({
  args: { refreshToken: v.optional(v.string()), proof: v.optional(v.any()) },
  handler: async (ctx, args) => {
    if (Object.keys(args).length === 0) {
      const userId = await getAuthUserId(ctx),
        sessionId = await getAuthSessionId(ctx);
      if (!userId || !sessionId) return;
      await ctx.runMutation(
        makeFunctionReference<"mutation">("authSupport:revokeSession") as any,
        { userId, sessionId },
      );
      return;
    }
    if (
      Object.keys(args).sort().join(",") !== "proof,refreshToken" ||
      typeof args.refreshToken !== "string" ||
      args.refreshToken.length > 512 ||
      !/^[a-zA-Z0-9]+\|[a-zA-Z0-9]+$/.test(args.refreshToken) ||
      !(await verifyGatewayRequest(
        "logout",
        { refreshToken: args.refreshToken },
        args.proof,
        {
          secret: process.env.ATTENDANCE_GATEWAY_KEY,
          audience: process.env.ATTENDANCE_GATEWAY_AUDIENCE,
        },
      ))
    )
      throw new ConvexError({
        status: 403,
        message: "Invalid sign-out request.",
      });
    const revoked = await ctx.runMutation(
      makeFunctionReference<"mutation">("authSupport:revokeFromRefresh") as any,
      { refreshToken: args.refreshToken },
    );
    if (!revoked)
      throw new ConvexError({
        status: 401,
        message: "Invalid sign-out request.",
      });
  },
});
// Convex Auth 0.0.96 exposes no supported action composition API. This pinned
// adapter must be reviewed on upgrades: _handler is an SDK internal property.
export const signIn = action({
  args: {
    provider: v.optional(v.string()),
    params: v.optional(v.any()),
    verifier: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    calledBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const keys = Object.keys(args);
    const refresh =
      keys.length === 1 &&
      typeof args.refreshToken === "string" &&
      /^[a-zA-Z0-9]+\|[a-zA-Z0-9]+$/.test(args.refreshToken) &&
      args.refreshToken.length <= 512;
    const p = args.params;
    const credentials =
      keys.length === 2 &&
      args.provider === "credentials" &&
      p &&
      typeof p === "object" &&
      !Array.isArray(p) &&
      Object.keys(p).sort().join(",") === "operation,password,proof,username" &&
      ["login", "signup"].includes(p.operation) &&
      typeof p.username === "string" &&
      typeof p.password === "string" &&
      p.proof &&
      typeof p.proof === "object";
    if (!refresh && !credentials) throw new Error("Invalid sign-in request.");
    if (
      credentials &&
      (!/^[a-z0-9._-]{3,40}$/.test(p.username) ||
        p.password.length < 10 ||
        p.password.length > 128 ||
        !(await verifyGatewayRequest(
          p.operation,
          { username: p.username, password: p.password },
          p.proof,
          {
            secret: process.env.ATTENDANCE_GATEWAY_KEY,
            audience: process.env.ATTENDANCE_GATEWAY_AUDIENCE,
          },
        )))
    )
      throw new Error("Invalid sign-in request.");
    try {
      const result = await (managed.signIn as any)._handler(ctx, args);
      if (credentials && result.tokens === null)
        throw new ConvexError({
          status: 401,
          message: "Authentication failed.",
        });
      return result;
    } catch (error) {
      const status = (error as any)?.data?.status;
      if (
        typeof status === "number" &&
        [400, 401, 403, 409, 429, 503].includes(status)
      )
        throw new ConvexError({ status, message: "Authentication failed." });
      throw new ConvexError({
        status: 503,
        message: "Authentication unavailable.",
      });
    }
  },
});
