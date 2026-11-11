import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { fail, requireReady, requireViewer } from "./access";
import { sha256 } from "./rosters";

const indexClaimRef = makeFunctionReference<"mutation">("legacy:indexClaim") as any;

export const claim = mutation({
  args: { legacyKey: v.string() },
  handler: async (ctx, { legacyKey }) => {
    await requireReady(ctx, true);
    const { user } = await requireViewer(ctx);
    if (!/^[a-f0-9]{64}$/.test(legacyKey)) fail(400, "Invalid previous workspace key.");
    const ownerKey = sha256(legacyKey);
    let owner = await ctx.db.query("ownerLinks").withIndex("by_owner", q => q.eq("ownerKey", ownerKey)).unique();
    if (owner && owner.userId !== user._id) fail(409, "This workspace already belongs to another account.");
    if (owner?.directoryComplete !== false && owner) return { ownerKey };
    if (!owner) {
      const [existingClass] = await ctx.db.query("classes").withIndex("by_owner", q => q.eq("ownerKey", ownerKey)).take(1);
      if (!existingClass) fail(404, "This previous workspace could not be found.");
      const id = await ctx.db.insert("ownerLinks", { ownerKey, userId: user._id, directoryComplete: false });
      owner = (await ctx.db.get(id))!;
    }
    // Repeating a claim after reload is safe: each directory edge is checked
    // transactionally, and an already complete claim writes nothing.
    await ctx.scheduler.runAfter(0, indexClaimRef, { ownerKey, userId: user._id, cursor: null });
    return { ownerKey };
  },
});

export const claimStatus = query({
  args: { ownerKey: v.string() },
  handler: async (ctx, { ownerKey }) => {
    await requireReady(ctx);
    const { user } = await requireViewer(ctx);
    if (!/^[a-f0-9]{64}$/.test(ownerKey)) fail(400, "Invalid workspace.");
    const owner = await ctx.db.query("ownerLinks").withIndex("by_owner", q => q.eq("ownerKey", ownerKey)).unique();
    if (!owner || owner.userId !== user._id) fail(403, "This workspace is unavailable.");
    return { complete: owner.directoryComplete !== false };
  },
});

export const indexClaim = internalMutation({
  args: { ownerKey: v.string(), userId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { ownerKey, userId, cursor }) => {
    await requireReady(ctx, true);
    const owner = await ctx.db.query("ownerLinks").withIndex("by_owner", q => q.eq("ownerKey", ownerKey)).unique();
    if (!owner || owner.userId !== userId || owner.directoryComplete !== false || !await ctx.db.get(userId)) return;
    const page = await ctx.db.query("classes").withIndex("by_owner", q => q.eq("ownerKey", ownerKey))
      .paginate({ numItems: 50, cursor, maximumRowsRead: 50 });
    for (const klass of page.page) {
      const edge = await ctx.db.query("memberships").withIndex("by_class_user", q => q.eq("classId", klass._id).eq("userId", userId)).unique();
      if (!edge) await ctx.db.insert("memberships", { classId: klass._id, userId, role: "owner" });
      else if (edge.role !== "owner") await ctx.db.patch(edge._id, { role: "owner" });
    }
    if (page.isDone) await ctx.db.patch(owner._id, { directoryComplete: true });
    else await ctx.scheduler.runAfter(0, indexClaimRef, { ownerKey, userId, cursor: page.continueCursor });
  },
});
