import { readJson, HttpError } from "../../../../lib/http.mjs";
import {
  checkOrigin,
  failure,
  proofFor,
} from "../../../../lib/convex-auth-gateway";

export const runtime = "nodejs";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

async function send(req: Request, operation: string, payload: object) {
  const proof = await proofFor(req, operation, payload);
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!site) throw new HttpError("Gateway unavailable.", 503);
  const response = await fetch(new URL(`/gateway/${operation}`, site), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ payload, proof }),
    cache: "no-store",
  });
  const data = await response.json();
  return Response.json(data, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  try {
    checkOrigin(request);
    const params = new URL(request.url).searchParams;
    const token = params.get("token");
    if (
      !token ||
      !TOKEN_PATTERN.test(token) ||
      [...params.keys()].length !== 1
    ) {
      throw new HttpError("This reset link is invalid or has expired.", 404);
    }
    return await send(request, "password-reset-info", { token });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const body = await readJson(request, 4096);
    if (
      Object.keys(body).sort().join(",") !== "password,token" ||
      typeof body.token !== "string" ||
      !TOKEN_PATTERN.test(body.token) ||
      typeof body.password !== "string" ||
      body.password.length < 10 ||
      body.password.length > 128
    ) {
      throw new HttpError("Use a password of 10–128 characters.", 400);
    }
    return await send(request, "password-reset", {
      token: body.token,
      password: body.password,
    });
  } catch (e) {
    return failure(e);
  }
}
