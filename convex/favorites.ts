import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { nowIso, requireUser } from "./authHelpers";

export const listFavoriteRestaurantIds = queryGeneric({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user_id", (query) => query.eq("userId", user._id))
      .collect();

    return favorites.map((favorite) => favorite.restaurantId);
  },
});

export const setFavorite = mutationGeneric({
  args: {
    sessionToken: v.string(),
    restaurantId: v.id("restaurants"),
    isFavorite: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    const favorite = await ctx.db
      .query("favorites")
      .withIndex("by_user_restaurant", (query) =>
        query.eq("userId", user._id).eq("restaurantId", args.restaurantId),
      )
      .unique();

    if (args.isFavorite && !favorite) {
      await ctx.db.insert("favorites", {
        userId: user._id,
        restaurantId: args.restaurantId,
        createdAt: nowIso(),
      });
    }

    if (!args.isFavorite && favorite) {
      await ctx.db.delete(favorite._id);
    }

    return { ok: true, isFavorite: args.isFavorite };
  },
});

export const syncFavoriteRestaurantIds = mutationGeneric({
  args: {
    sessionToken: v.string(),
    restaurantIds: v.array(v.id("restaurants")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    const uniqueRestaurantIds = Array.from(
      new Map(args.restaurantIds.map((restaurantId) => [String(restaurantId), restaurantId])).values(),
    );

    for (const restaurantId of uniqueRestaurantIds) {
      const existing = await ctx.db
        .query("favorites")
        .withIndex("by_user_restaurant", (query) =>
          query.eq("userId", user._id).eq("restaurantId", restaurantId),
        )
        .unique();

      if (!existing) {
        await ctx.db.insert("favorites", {
          userId: user._id,
          restaurantId,
          createdAt: nowIso(),
        });
      }
    }

    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user_id", (query) => query.eq("userId", user._id))
      .collect();

    return favorites.map((favorite) => favorite.restaurantId);
  },
});
