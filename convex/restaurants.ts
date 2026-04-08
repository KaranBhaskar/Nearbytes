import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { fallbackRestaurants } from "./fallbackRestaurants";

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeTag(tag: string) {
  const normalized = String(tag || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  return normalized === "gluten_free" ? "gluten-free" : normalized;
}

function buildRestaurantSummary(
  restaurant: Record<string, any>,
  origin: { lat: number; lng: number },
) {
  const googleRating = restaurant.googleRating ?? null;
  const googleRatingCount = Number(restaurant.googleRatingCount || 0);
  const coverImage =
    restaurant.coverImage || restaurant.images.find((image: any) => image.isCover)?.url || null;

  return {
    id: restaurant._id,
    name: restaurant.name,
    address: restaurant.address,
    lat: restaurant.lat,
    lng: restaurant.lng,
    description: restaurant.description,
    phone: restaurant.phone,
    website: restaurant.website,
    openingHours: restaurant.openingHours,
    menuUrl: restaurant.menuUrl,
    cuisineTags: restaurant.cuisineTags || [],
    dietaryTags: restaurant.dietaryTags || [],
    coverImage,
    images: restaurant.images || [],
    menuItems: restaurant.menuItems || [],
    source: restaurant.source,
    syncStatus: restaurant.syncStatus,
    googleRating,
    googleRatingCount,
    appRating: null,
    appRatingCount: 0,
    combinedRating: googleRating,
    combinedRatingCount: googleRatingCount,
    distanceKm: haversineKm(origin.lat, origin.lng, restaurant.lat, restaurant.lng),
  };
}

export const ensureFallbackRestaurants = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    let inserted = 0;

    for (const restaurant of fallbackRestaurants) {
      const existing = await ctx.db
        .query("restaurants")
        .withIndex("by_fallback_key", (query) =>
          query.eq("fallbackKey", restaurant.fallbackKey),
        )
        .unique();

      if (existing) {
        continue;
      }

      await ctx.db.insert("restaurants", restaurant);
      inserted += 1;
    }

    const total = (await ctx.db.query("restaurants").collect()).length;
    return { inserted, total };
  },
});

export const listNearby = queryGeneric({
  args: {
    lat: v.number(),
    lng: v.number(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    dietary: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const restaurants = await ctx.db.query("restaurants").collect();
    const dietaryFilters = (args.dietary || []).map(normalizeTag);
    const offset = Number.parseInt(String(args.cursor || "0"), 10) || 0;
    const limit = Math.max(1, Math.min(20, Number(args.limit || 20)));

    const items = restaurants
      .map((restaurant) =>
        buildRestaurantSummary(restaurant, { lat: args.lat, lng: args.lng }),
      )
      .filter((restaurant) => {
        if (!dietaryFilters.length) {
          return true;
        }

        const restaurantTags = (restaurant.dietaryTags || []).map(normalizeTag);
        const keywordSource = [
          restaurant.name,
          restaurant.description,
          restaurant.address,
          ...(restaurant.cuisineTags || []),
          ...(restaurant.dietaryTags || []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return dietaryFilters.every((tag) => {
          const keywordVariant = tag.replace(/-/g, " ");
          return (
            restaurantTags.includes(tag) ||
            keywordSource.includes(tag) ||
            keywordSource.includes(keywordVariant)
          );
        });
      })
      .sort((left, right) => left.distanceKm - right.distanceKm);

    const page = items.slice(offset, offset + limit);
    const nextOffset = offset + page.length;
    const hasMore = nextOffset < items.length;

    return {
      items: page,
      nextCursor: hasMore ? String(nextOffset) : null,
      hasMore,
      total: items.length,
    };
  },
});

export const getRestaurantDetail = queryGeneric({
  args: {
    id: v.id("restaurants"),
    originLat: v.optional(v.number()),
    originLng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const restaurant = await ctx.db.get(args.id);
    if (!restaurant) {
      return null;
    }

    const origin = {
      lat: Number.isFinite(args.originLat) ? args.originLat : restaurant.lat,
      lng: Number.isFinite(args.originLng) ? args.originLng : restaurant.lng,
    };

    const detail = buildRestaurantSummary(restaurant, origin);

    return {
      restaurant: detail,
      images: restaurant.images || [],
      menuItems: restaurant.menuItems || [],
      reviews: [],
      myReview: null,
    };
  },
});
