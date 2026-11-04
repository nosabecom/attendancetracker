import { fetchAction } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { readJson, HttpError } from "./http.mjs";
import { checkOrigin, failure, proofFor } from "./convex-auth-gateway";

type Call = (
  action: "auth:signIn" | "auth:signOut",
  args: Record<string, unknown>,
  token?: string,
) => Promise<any>;
const call: Call = (action, args, token) =>
  fetchAction(action as any, args as any, token ? { token } : {});
const messages: Record<number, string> = {
  400: "Invalid sign-in request.",
  401: "Incorrect username or password.",
  403: "Request not allowed.",
  409: "That username is unavailable. Sign in or choose another.",
  429: "Too many attempts. Please try again later.",
  503: "Sign-in is temporarily unavailable.",
};

// Matches the pinned Convex Auth Next provider's cookies. This adapter owns
// admission and safe transport; the maintained backend owns tokens and sessions.
function names(request: NextRequest) {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const local = /^(localhost|127\.0\.0\.1):\d+$/.test(host);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    request.nextUrl.hostname,
  );
  if (
    (loopback && request.nextUrl.protocol === "http:" && !local) ||
    (/(localhost|127\.0\.0\.1):\d+/.test(host) && !local)
  )
    throw new HttpError("Sign-in is temporarily unavailable.", 503);
  const prefix = local ? "" : "__Host-";
  return {
    token: `${prefix}__convexAuthJWT`,
    refresh: `${prefix}__convexAuthRefreshToken`,
    verifier: `${prefix}__convexAuthOAuthVerifier`,
    secure: !local,
  };
}

function respond(
  request: NextRequest,
  value: unknown,
  tokens?: { token: string; refreshToken: string } | null,
) {
  const response = NextResponse.json(value, {
    headers: { "Cache-Control": "no-store" },
  });
  if (tokens === undefined) return response;
  const cookie = names(request);
  const options = {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: cookie.secure,
  };
  if (tokens === null) {
    for (const name of [cookie.token, cookie.refresh, cookie.verifier])
      response.cookies.set(name, "", { ...options, expires: new Date(0) });
    return response;
  }
  let deadline: number;
  try {
    deadline = JSON.parse(
      Buffer.from(tokens.token.split(".")[1], "base64url").toString(),
    ).sessionExpiresAt;
  } catch {
    throw new HttpError("Sign-in is temporarily unavailable.", 503);
  }
  const remaining = Math.floor((deadline - Date.now()) / 1000);
  if (
    !Number.isSafeInteger(deadline) ||
    remaining < 1 ||
    remaining > 30 * 86400
  )
    throw new HttpError("Sign-in is temporarily unavailable.", 503);
  response.cookies.set(cookie.token, tokens.token, {
    ...options,
    maxAge: remaining,
  });
  response.cookies.set(cookie.refresh, tokens.refreshToken, {
    ...options,
    maxAge: remaining,
  });
  response.cookies.set(cookie.verifier, "", {
    ...options,
    expires: new Date(0),
  });
  return response;
}

export async function handleConvexAuth(
  request: NextRequest,
  invoke: Call = call,
) {
  let refreshAttempt = false;
  try {
    if (request.method !== "POST") throw new HttpError("Invalid method.", 405);
    checkOrigin(request);
    const body = await readJson(request, 4096);
    if (Object.keys(body).some((key) => !["action", "args"].includes(key)))
      throw new HttpError("Invalid request.");
    const args = body.args === undefined ? {} : body.args;
    if (!args || typeof args !== "object" || Array.isArray(args))
      throw new HttpError("Invalid request.");
    const cookie = names(request),
      token = request.cookies.get(cookie.token)?.value;
    const refreshToken = request.cookies.get(cookie.refresh)?.value;
    if (body.action === "auth:signOut") {
      if (Object.keys(args).length) throw new HttpError("Invalid request.");
      let revoked = false,
        accessFailure;
      if (token) {
        try {
          await invoke("auth:signOut", {}, token);
          revoked = true;
        } catch (error) {
          accessFailure = error;
        }
      }
      if (!revoked && refreshToken) {
        const payload = { refreshToken };
        await invoke("auth:signOut", {
          ...payload,
          proof: await proofFor(request, "logout", payload),
        });
        revoked = true;
      }
      if (token && !revoked) throw accessFailure;
      return respond(request, null, null);
    }
    if (body.action !== "auth:signIn") throw new HttpError("Invalid request.");
    const refresh =
      Object.keys(args).join(",") === "refreshToken" &&
      args.refreshToken === "dummy";
    let result;
    if (refresh) {
      refreshAttempt = true;
      if (!refreshToken) return respond(request, { tokens: null }, null);
      result = await invoke("auth:signIn", { refreshToken });
    } else {
      const params = args.params;
      if (
        Object.keys(args).sort().join(",") !== "params,provider" ||
        args.provider !== "credentials" ||
        !params ||
        typeof params !== "object" ||
        Array.isArray(params) ||
        Object.keys(params).sort().join(",") !==
          "operation,password,username" ||
        !["login", "signup"].includes(params.operation) ||
        typeof params.username !== "string" ||
        typeof params.password !== "string"
      )
        throw new HttpError("Invalid sign-in request.");
      const username = params.username.trim().toLowerCase(),
        password = params.password;
      if (
        !/^[a-z0-9._-]{3,40}$/.test(username) ||
        password.length < 10 ||
        password.length > 128
      )
        throw new HttpError("Invalid credentials.");
      result = await invoke("auth:signIn", {
        provider: "credentials",
        params: {
          operation: params.operation,
          username,
          password,
          proof: await proofFor(request, params.operation, {
            username,
            password,
          }),
        },
      });
    }
    if (
      !result ||
      !("tokens" in result) ||
      (result.tokens !== null &&
        (typeof result.tokens?.token !== "string" ||
          typeof result.tokens?.refreshToken !== "string"))
    )
      throw new HttpError("Sign-in is temporarily unavailable.", 503);
    return respond(
      request,
      {
        tokens:
          result.tokens === null
            ? null
            : { token: result.tokens.token, refreshToken: "dummy" },
      },
      result.tokens,
    );
  } catch (error) {
    if (error instanceof HttpError) return failure(error);
    const status = (error as any)?.data?.status;
    if (refreshAttempt && [401, 403].includes(status))
      return respond(request, { tokens: null }, null);
    const safeStatus =
      typeof status === "number" && Object.hasOwn(messages, status)
        ? status
        : 503;
    // SDK errors can contain request details. Never log or serialize them.
    return failure(new HttpError(messages[safeStatus], safeStatus));
  }
}
