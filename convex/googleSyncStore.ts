import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { normalizeTag } from "./restaurantHelpers";

const imageValidator = v.object({
  url: v.string(),
  isCover: v.boolean(),
  authorAttributions: v.optional(
    v.array(
      v.object({
        displayName: v.union(v.string(), v.null()),
        uri: v.union(v.string(), v.null()),
        photoUri: v.union(v.string(), v.null()),
      }),
    ),
  ),
});

const menuItemValidator = v.object({
  name: v.string(),
  description: v.union(v.string(), v.null()),
  price: v.number(),
  imageUrl: v.union(v.string(), v.null()),
});

export const getNearbySyncCache = internalQuery({
  args: {
    cacheKey: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db
      .query("nearbySyncCache")
      .withIndex("by_cache_key", (query) => query.eq("cacheKey", args.cacheKey))
      .unique();
  },
});

export const getRestaurantsForTagEnrichment = internalQuery({
  args: {
    restaurantIds: v.array(v.id("restaurants")),
  },
  handler: async (ctx, args) => {
    const restaurants = await Promise.all(args.restaurantIds.map((restaurantId) => ctx.db.get(restaurantId)));
    return restaurants.filter(Boolean).map((restaurant) => ({
      _id: restaurant._id,
      source: restaurant.source,
      googlePlaceId: restaurant.googlePlaceId || null,
      name: restaurant.name,
      address: restaurant.address,
      description: restaurant.description,
      website: restaurant.website,
      primaryType: restaurant.primaryType,
      cuisineTags: restaurant.cuisineTags || [],
      dietaryTags: restaurant.dietaryTags || [],
      menuItems: restaurant.menuItems || [],
      openingHours: restaurant.openingHours,
    }));
  },
});

export const recordNearbySyncResult = internalMutation({
  args: {
    cacheKey: v.string(),
    centerLat: v.number(),
    centerLng: v.number(),
    radiusMeters: v.number(),
    status: v.string(),
    source: v.string(),
    itemCount: v.number(),
    lastAttemptAt: v.string(),
    lastSyncedAt: v.union(v.string(), v.null()),
    errorMessage: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("nearbySyncCache")
      .withIndex("by_cache_key", (query) => query.eq("cacheKey", args.cacheKey))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, args);
      return existing._id;
    }

    return ctx.db.insert("nearbySyncCache", args);
  },
});

export const upsertGoogleRestaurants = internalMutation({
  args: {
    restaurants: v.array(
      v.object({
        googlePlaceId: v.string(),
        source: v.string(),
        syncStatus: v.string(),
        lastSyncedAt: v.string(),
        name: v.string(),
        address: v.string(),
        lat: v.number(),
        lng: v.number(),
        description: v.union(v.string(), v.null()),
        phone: v.union(v.string(), v.null()),
        website: v.union(v.string(), v.null()),
        googleMapsUri: v.union(v.string(), v.null()),
        openingHours: v.union(v.string(), v.null()),
        menuUrl: v.union(v.string(), v.null()),
        primaryType: v.union(v.string(), v.null()),
        cuisineTags: v.array(v.string()),
        dietaryTags: v.array(v.string()),
        coverImage: v.union(v.string(), v.null()),
        images: v.array(imageValidator),
        menuItems: v.array(menuItemValidator),
        googleRating: v.union(v.number(), v.null()),
        googleRatingCount: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    let inserted = 0;
    let updated = 0;

    for (const restaurant of args.restaurants) {
      const existing = await ctx.db
        .query("restaurants")
        .withIndex("by_google_place_id", (query) =>
          query.eq("googlePlaceId", restaurant.googlePlaceId),
        )
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          ...restaurant,
        });
        updated += 1;
        continue;
      }

      await ctx.db.insert("restaurants", {
        ownerUserId: undefined,
        createdByUserId: undefined,
        isHidden: false,
        hiddenReason: null,
        hiddenAt: null,
        hiddenByUserId: undefined,
        ...restaurant,
      });
      inserted += 1;
    }

    return { inserted, updated };
  },
});

export const applyGeminiRestaurantEnrichment = internalMutation({
  args: {
    restaurants: v.array(
      v.object({
        restaurantId: v.id("restaurants"),
        cuisineTags: v.array(v.string()),
        dietaryTags: v.array(v.string()),
        menuItems: v.array(menuItemValidator),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const updates = [];

    for (const update of args.restaurants) {
      const existing = await ctx.db.get(update.restaurantId);
      if (!existing) {
        continue;
      }

      const cuisineTags = Array.from(
        new Set([...(existing.cuisineTags || []), ...update.cuisineTags].map(normalizeTag).filter(Boolean)),
      );
      const dietaryTags = Array.from(
        new Set([...(existing.dietaryTags || []), ...update.dietaryTags].map(normalizeTag).filter(Boolean)),
      );
      const menuItems = Array.isArray(existing.menuItems) && existing.menuItems.length
        ? existing.menuItems
        : update.menuItems;

      await ctx.db.patch(existing._id, {
        cuisineTags,
        dietaryTags,
        menuItems,
      });

      updates.push({
        restaurantId: existing._id,
        cuisineTags,
        dietaryTags,
        menuItems,
      });
    }

    return updates;
  },
});
