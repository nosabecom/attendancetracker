import { ConvexError } from "convex/values";

function localTestDuration(name: string, fallback: number, maximum: number) {
  let local = false;
  try { local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.CONVEX_SITE_URL!).hostname); } catch {}
  const supplied = local ? process.env[name] : undefined;
  if (supplied === undefined) return fallback;
  const value = Number(supplied);
  if (!Number.isSafeInteger(value) || value < 1000 || value > maximum) throw new Error("Invalid local auth test configuration.");
  return value;
}

// Short lifetimes are restricted to the local backend for real expiry tests.
// Cloud deployments always use the production policy.
export const SESSION_DURATION_MS = localTestDuration("ATTENDANCE_LOCAL_TEST_SESSION_MS", 30 * 86400000, 30 * 86400000);
export const JWT_DURATION_MS = localTestDuration("ATTENDANCE_LOCAL_TEST_JWT_MS", 3600000, 3600000);
export const JWT_EXPIRY_MARGIN_MS = localTestDuration("ATTENDANCE_LOCAL_TEST_MARGIN_MS", 60000, 60000);

export async function sessionClaims(ctx: { db: { get: (id: any) => Promise<any> } },
  { userId, sessionId }: { userId: any; sessionId: any }, now = Date.now()) {
  const session = await ctx.db.get(sessionId);
  if (!session || session.userId !== userId || !Number.isSafeInteger(session.expirationTime) ||
      session.expirationTime - now < JWT_DURATION_MS + JWT_EXPIRY_MARGIN_MS || !await ctx.db.get(userId))
    throw new ConvexError({ status: 401, message: "Your session has expired. Sign in again." });
  return { sessionExpiresAt: session.expirationTime };
}
