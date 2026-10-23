import { randomBytes } from "node:crypto";
import {
  account,
  hash,
  HttpError,
  sameOrigin,
  passwordHash,
  verify,
  cookie,
  newSession,
  logout,
  throttle,
  claimLegacy,
  type Account,
} from "../../../lib/auth";
import { read, write } from "../../../lib/storage";
import { readJson } from "../../../lib/http.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function json(data: unknown, status = 200, sessionCookie?: string) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(sessionCookie ? { "Set-Cookie": sessionCookie } : {}),
    },
  });
}
function fail(e: unknown) {
  return json(
    {
      error:
        e instanceof HttpError
          ? e.message
          : "Unable to sign in right now. Please try again.",
    },
    e instanceof HttpError ? e.status : 500,
  );
}
export async function GET(req: Request) {
  try {
    const a = await account(req);
    return json({ username: a.username });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const b = await readJson(req, 4096);
    if (b.action === "logout") {
      await logout(req);
      return json({ ok: true }, 200, cookie("", req, 0));
    }
    if (b.action === "migrate") {
      const a = await account(req);
      await claimLegacy(a.owner, b.legacyKey);
      return json({ ok: true });
    }
    if (!["signup", "login"].includes(b.action))
      throw new HttpError("Unknown action.");
    const username = String(b.username || "")
        .trim()
        .toLowerCase(),
      password = b.password;
    if (!/^[a-z0-9._-]{3,40}$/.test(username))
      throw new HttpError(
        "Use a username of 3–40 letters, numbers, dots, dashes, or underscores.",
      );
    if (
      typeof password !== "string" ||
      password.length < 10 ||
      password.length > 128
    )
      throw new HttpError("Use a password of 10–128 characters.");
    await throttle(req, username);
    const path = `auth/accounts/${hash(username)}.json`;
    let user = (await read(path)) as Account | null;
    if (b.action === "signup") {
      if (user)
        throw new HttpError(
          "That username is unavailable. Sign in or choose another.",
          409,
        );
      const salt = randomBytes(16).toString("hex");
      user = {
        owner: randomBytes(32).toString("hex"),
        username,
        salt,
        passwordHash: await passwordHash(password, salt),
      };
      try {
        await write(path, user);
      } catch {
        if (await read(path))
          throw new HttpError(
            "That username is unavailable. Sign in or choose another.",
            409,
          );
        throw new Error("Account storage failed.");
      }
    } else if (!(await verify(password, user)))
      throw new HttpError("Incorrect username or password.", 401);
    const t = await newSession(user!);
    return json({ username: user!.username }, 200, cookie(t, req));
  } catch (e) {
    console.error(
      e instanceof HttpError ? e.message : "Authentication storage failure",
    );
    return fail(e);
  }
}
