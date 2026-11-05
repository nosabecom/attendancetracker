// Deployment-administrator maintenance controls. These are internal functions,
// never a browser or gateway endpoint. They cannot activate an unverified import.
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type QueryCtx,
} from "./_generated/server";

async function activeState(ctx: QueryCtx, fingerprint: string) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint))
    throw new ConvexError("operations_invalid_fingerprint");
  const states = await ctx.db.query("deploymentState").take(2);
  const state = states[0];
  if (states.length !== 1 || state.key !== "migration" || !state.activeRunId)
    throw new ConvexError("operations_invalid_state");
  const run = await ctx.db.get(state.activeRunId);
  const matching = await ctx.db
    .query("migrationRuns")
    .withIndex("by_fingerprint", (q) => q.eq("fingerprint", fingerprint))
    .take(2);
  if (
    !run ||
    run.status !== "active" ||
    run.fingerprint !== fingerprint ||
    matching.length !== 1 ||
    matching[0]._id !== run._id
  )
    throw new ConvexError("operations_dataset_mismatch");
  return state;
}

export const availability = internalQuery({
  args: { fingerprint: v.string() },
  handler: async (ctx, { fingerprint }) => {
    const state = await activeState(ctx, fingerprint);
    return {
      readsEnabled: state.readsEnabled,
      writesEnabled: state.writesEnabled,
    };
  },
});

export const setAvailability = internalMutation({
  args: {
    fingerprint: v.string(),
    readsEnabled: v.boolean(),
    writesEnabled: v.boolean(),
  },
  handler: async (ctx, { fingerprint, readsEnabled, writesEnabled }) => {
    if (writesEnabled && !readsEnabled)
      throw new ConvexError("operations_invalid_availability");
    const state = await activeState(ctx, fingerprint);
    if (
      state.readsEnabled !== readsEnabled ||
      state.writesEnabled !== writesEnabled
    )
      await ctx.db.patch(state._id, { readsEnabled, writesEnabled });
    return { readsEnabled, writesEnabled };
  },
});

// Omit partition to drain legacy unassigned rows; otherwise drain exactly one
// partition (0..63). Admins repeat bounded calls and visit partitions separately.
// No caller-supplied cutoff: a still-usable proof must never lose its receipt.
export const pruneSecurity = internalMutation({
  args: { fingerprint: v.string(), partition: v.optional(v.number()) },
  handler: async (ctx, { fingerprint, partition }) => {
    if (
      partition !== undefined &&
      (!Number.isInteger(partition) || partition < 0 || partition >= 64)
    )
      throw new ConvexError("operations_invalid_partition");
    await activeState(ctx, fingerprint);
    const now = Date.now();
    const nonces = await ctx.db
      .query("gatewayNonces")
      .withIndex("by_partition_expiry", (q) =>
        q.eq("partition", partition).lt("expiresAt", now),
      )
      .take(101);
    const noncePage = nonces.slice(0, 100);
    const remaining = 100 - noncePage.length;
    const counters = await ctx.db
      .query("throttleCounters")
      .withIndex("by_partition_expiry", (q) =>
        q.eq("partition", partition).lt("expiresAt", now),
      )
      .take(remaining + 1);
    const counterPage = counters.slice(0, remaining);
    for (const row of noncePage) await ctx.db.delete(row._id);
    for (const row of counterPage) await ctx.db.delete(row._id);
    return {
      noncesDeleted: noncePage.length,
      countersDeleted: counterPage.length,
      more: nonces.length > noncePage.length || counters.length > counterPage.length,
    };
  },
});
