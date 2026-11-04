// Administrative fixtures for the actual local-backend integration tests.
// Internal visibility and the system-provided local URL both gate these tools.
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import schema from "./schema";
import { sha256 } from "./rosters";

function requireLocal() {
  let local = false;
  try { local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.CONVEX_SITE_URL!).hostname); } catch {}
  if (!local) throw new Error("Local integration fixtures are unavailable.");
}

export const initializeEmpty = internalMutation({ args: {}, handler: async ctx => {
  requireLocal();
  const source = { formatVersion: 1, accounts: [], legacyClaims: [], legacyImports: [], classes: [], rosterVersions: [], sessions: [], attendance: [] };
  const fingerprint = sha256(JSON.stringify(source));
  const prior = await ctx.db.query("deploymentState").withIndex("by_key", q => q.eq("key", "migration")).unique();
  if (prior) {
    const run = prior.activeRunId && await ctx.db.get(prior.activeRunId);
    if (run && run.fingerprint === fingerprint && run.status === "active" && prior.readsEnabled && prior.writesEnabled)
      return { ready: true };
    throw new Error("Local deployment already contains another dataset.");
  }
  for (const table of Object.keys(schema.tables)) {
    if ((await ctx.db.query(table as any).take(1)).length) throw new Error("Local initialization requires an empty deployment.");
  }
  const runId = await ctx.db.insert("migrationRuns", { fingerprint, status: "active", exportedAt: new Date().toISOString(),
    expectedCounts: { accounts: 0, legacyClaims: 0, classes: 0, rosterVersions: 0, rosterMembers: 0,
      memberships: 0, sessions: 0, closures: 0, attendance: 0 } });
  await ctx.db.insert("deploymentState", { key: "migration", activeRunId: runId, readsEnabled: true, writesEnabled: true });
  return { ready: true };
} });

export const sessionState = internalQuery({ args: { sessionId: v.id("authSessions") }, handler: async (ctx, { sessionId }) => {
  requireLocal();
  const session = await ctx.db.get(sessionId);
  return { exists: session !== null, expiresAt: session?.expirationTime ?? null };
} });

export const delayExpiryCleanup = internalMutation({ args: { sessionId: v.id("authSessions") }, handler: async (ctx, { sessionId }) => {
  requireLocal();
  const pending = await ctx.db.system.query("_scheduled_functions").take(1000);
  let cancelled = 0;
  for (const job of pending) {
    if (["authSupport:cleanupSession", "authSupport.js:cleanupSession"].includes(job.name) && job.args[0]?.sessionId === sessionId && job.state.kind === "pending") {
      await ctx.scheduler.cancel(job._id); cancelled++;
    }
  }
  return { cancelled };
} });
