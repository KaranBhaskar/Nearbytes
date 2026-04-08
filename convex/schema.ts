import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    email: v.string(),
    emailLower: v.string(),
    displayName: v.string(),
    role: v.string(),
    passwordHash: v.string(),
    passwordSalt: v.string(),
    createdAt: v.string(),
    lastLoginAt: v.union(v.string(), v.null()),
  }).index("by_email_lower", ["emailLower"]),
  sessions: defineTable({
    userId: v.id("users"),
    tokenHash: v.string(),
    createdAt: v.string(),
    expiresAt: v.string(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_user_id", ["userId"]),
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
    ownerUserId: v.optional(v.id("users")),
    createdByUserId: v.optional(v.id("users")),
    googlePlaceId: v.union(v.string(), v.null()),
    googleRating: v.union(v.number(), v.null()),
    googleRatingCount: v.number(),
  })
    .index("by_fallback_key", ["fallbackKey"])
    .index("by_source", ["source"])
    .index("by_owner_user_id", ["ownerUserId"]),
  favorites: defineTable({
    userId: v.id("users"),
    restaurantId: v.id("restaurants"),
    createdAt: v.string(),
  })
    .index("by_user_id", ["userId"])
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_user_restaurant", ["userId", "restaurantId"]),
  reviews: defineTable({
    userId: v.id("users"),
    restaurantId: v.id("restaurants"),
    rating: v.number(),
    comment: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_restaurant_id", ["restaurantId"])
    .index("by_user_restaurant", ["userId", "restaurantId"])
    .index("by_user_id", ["userId"]),
});
