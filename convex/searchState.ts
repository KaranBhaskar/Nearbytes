import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { nowIso, requireUser } from "./authHelpers";

export const getMySearchState = queryGeneric({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    if (user.role !== "customer") {
      return null;
    }

    const state = await ctx.db
      .query("searchStates")
      .withIndex("by_user_id", (query) => query.eq("userId", user._id))
      .unique();

    if (!state) {
      return null;
    }

    return {
      lat: state.lat,
      lng: state.lng,
      label: state.label,
      shortLabel: state.shortLabel,
      radiusMeters: state.radiusMeters,
      loadedCount: state.loadedCount,
      dietaryFilters: state.dietaryFilters || [],
      updatedAt: state.updatedAt,
    };
  },
});

export const saveMySearchState = mutationGeneric({
  args: {
    sessionToken: v.string(),
    lat: v.number(),
    lng: v.number(),
    label: v.string(),
    shortLabel: v.optional(v.string()),
    radiusMeters: v.number(),
    loadedCount: v.number(),
    dietaryFilters: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    if (user.role !== "customer") {
      return { ok: false, skipped: true };
    }

    const existing = await ctx.db
      .query("searchStates")
      .withIndex("by_user_id", (query) => query.eq("userId", user._id))
      .unique();

    const payload = {
      userId: user._id,
      lat: args.lat,
      lng: args.lng,
      label: args.label,
      shortLabel: args.shortLabel || null,
      radiusMeters: Math.max(1000, Math.round(args.radiusMeters)),
      loadedCount: Math.max(0, Math.round(args.loadedCount)),
      dietaryFilters: args.dietaryFilters || [],
      updatedAt: nowIso(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return { ok: true, updated: true };
    }

    await ctx.db.insert("searchStates", payload);
    return { ok: true, updated: false };
  },
});

export const clearMySearchState = mutationGeneric({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    const existing = await ctx.db
      .query("searchStates")
      .withIndex("by_user_id", (query) => query.eq("userId", user._id))
      .unique();

    if (existing) {
      await ctx.db.delete(existing._id);
    }

    return { ok: true };
  },
});
