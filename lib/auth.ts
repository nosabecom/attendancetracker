import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { read, write, all, del } from "./storage";
const scrypt = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(
      password,
      salt,
      64,
      { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
export const COOKIE = "rollcall_session";
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type Account = {
  owner: string;
  username: string;
  passwordHash: string;
  salt: string;
};
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin) {
    let source: URL;
    try {
      source = new URL(origin);
    } catch {
      throw new HttpError("Request origin not allowed.", 403);
    }
    const target = new URL(req.url);
    if (
      source.host !== (req.headers.get("host") || target.host) ||
      source.protocol !== target.protocol
    )
      throw new HttpError("Request origin not allowed.", 403);
  }
}
function token(req: Request) {
  return req.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
}
export async function account(req: Request) {
  const t = token(req);
  if (!t || !/^[a-f0-9]{64}$/.test(t))
    throw new HttpError("Please sign in to your workspace.", 401);
  const s = await read(`auth/sessions/${hash(t)}.json`);
  if (!s || s.expiresAt < Date.now())
    throw new HttpError("Please sign in to your workspace.", 401);
  return s as { owner: string; username: string; expiresAt: number };
}
export async function passwordHash(password: string, salt: string) {
  return (await scrypt(password, salt)).toString("hex");
}
export async function verify(password: string, user: Account | null) {
  const computed = await passwordHash(
    password,
    user?.salt || "00000000000000000000000000000000",
  );
  return (
    timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(user?.passwordHash || "0".repeat(128), "hex"),
    ) && Boolean(user)
  );
}
export function cookie(
  value: string,
  req: Request,
  maxAge = 60 * 60 * 24 * 30,
) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function newSession(user: Account) {
  const t = randomBytes(32).toString("hex");
  await write(`auth/sessions/${hash(t)}.json`, {
    owner: user.owner,
    username: user.username,
    expiresAt: Date.now() + 30 * 86400000,
  });
  return t;
}
export async function logout(req: Request) {
  const t = token(req);
  if (t && /^[a-f0-9]{64}$/.test(t)) await del(`auth/sessions/${hash(t)}.json`);
}
export async function throttle(req: Request, username: string) {
  const ip =
    req.headers.get("x-vercel-forwarded-for") ||
    req.headers.get("x-forwarded-for") ||
    "local";
  const bucket = Math.floor(Date.now() / 900000);
  for (const [scope, value, limit] of [
    ["ip", ip, 40],
    ["user", username, 12],
  ] as const) {
    const prefix = `auth/attempts/${scope}/${hash(value)}/${bucket}/`;
    if ((await all(prefix)).length >= limit)
      throw new HttpError(
        "Too many attempts. Please try again in 15 minutes.",
        429,
      );
    await write(`${prefix}${randomBytes(12).toString("hex")}.json`, {});
  }
}
export async function claimLegacy(owner: string, key: unknown) {
  if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) return;
  const old = hash(key),
    path = `auth/claims/${old}.json`;
  let claim = await read(path);
  if (!claim) {
    try {
      await write(path, { owner });
    } catch {
      claim = await read(path);
      if (!claim) throw new Error("Could not import the existing workspace.");
    }
    claim = await read(path);
  }
  if (claim.owner !== owner)
    throw new HttpError(
      "This older workspace is already linked to a different account.",
      409,
    );
  const ref = `auth/imports/${owner}/${old}.json`;
  if (!(await read(ref))) {
    try {
      await write(ref, { old });
    } catch {
      if (!(await read(ref)))
        throw new Error("Workspace import failed. Please retry.");
    }
  }
}
export async function canAccess(owner: string, resourceOwner: string) {
  return (
    resourceOwner === owner ||
    (await read(`auth/claims/${resourceOwner}.json`))?.owner === owner
  );
}
