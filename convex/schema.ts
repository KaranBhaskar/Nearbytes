import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  restaurants: defineTable({
    fallbackKey: v.optional(v.string()),
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
    openingHours: v.union(v.string(), v.null()),
    menuUrl: v.union(v.string(), v.null()),
    cuisineTags: v.array(v.string()),
    dietaryTags: v.array(v.string()),
    coverImage: v.union(v.string(), v.null()),
    images: v.array(
      v.object({
        url: v.string(),
        isCover: v.boolean(),
      }),
    ),
    menuItems: v.array(
      v.object({
        name: v.string(),
        description: v.union(v.string(), v.null()),
        price: v.number(),
        imageUrl: v.union(v.string(), v.null()),
      }),
    ),
    googlePlaceId: v.union(v.string(), v.null()),
    googleRating: v.union(v.number(), v.null()),
    googleRatingCount: v.number(),
  })
    .index("by_fallback_key", ["fallbackKey"])
    .index("by_source", ["source"]),
});
