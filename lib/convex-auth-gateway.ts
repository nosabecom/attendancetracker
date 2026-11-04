import { isIP } from "node:net";
import { hashGatewayIp, signGatewayRequest } from "./gateway-proof.mjs";
import { HttpError } from "./http.mjs";
export function trustedIp(request: Request) {
  if (process.env.VERCEL) {
    const value = request.headers.get("x-vercel-forwarded-for");
    if (!value || !isIP(value))
      throw new HttpError("Invalid client address.", 403);
    return value;
  }
  let url: URL;
  try {
    url = new URL(process.env.NEXT_PUBLIC_CONVEX_URL || "");
  } catch {
    throw new HttpError("Gateway unavailable.", 503);
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new HttpError("Gateway unavailable.", 503);
  return "127.0.0.1";
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new HttpError("Invalid origin.", 403);
}
export async function proofFor(
  request: Request,
  operation: string,
  payload: object,
) {
  const secret = process.env.ATTENDANCE_GATEWAY_KEY,
    audience = process.env.ATTENDANCE_GATEWAY_AUDIENCE;
  if (!secret || !audience) throw new HttpError("Gateway unavailable.", 503);
  return signGatewayRequest(operation, payload, {
    secret,
    audience,
    ipHash: await hashGatewayIp(trustedIp(request)),
  });
}
export function failure(error: unknown) {
  const status = error instanceof HttpError ? error.status : 500;
  return Response.json(
    {
      error:
        error instanceof HttpError ? error.message : "Request unavailable.",
    },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
