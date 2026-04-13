import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import {
  normalizeHttpUrl,
  normalizeLatLng,
  normalizeOptionalString,
  normalizePrice,
  normalizeTagList,
  nowIso,
  requireRole,
  requireUser,
  resolveSession,
} from "./authHelpers";
import { buildRestaurantSummary, buildReviewStats, deleteRestaurantTree, normalizeTag } from "./restaurantHelpers";

function normalizeRestaurantInput(args: Record<string, any>) {
  const name = normalizeOptionalString(args.name, 120);
  const address = normalizeOptionalString(args.address, 240);

  if (!name) {
    throw new Error("Restaurant name is required.");
  }

  if (!address) {
    throw new Error("Restaurant address is required.");
  }

  return {
    name,
    address,
    description: normalizeOptionalString(args.description, 1500),
    phone: normalizeOptionalString(args.phone, 80),
    website: normalizeHttpUrl(args.website),
    openingHours: normalizeOptionalString(args.openingHours, 200),
    menuUrl: normalizeHttpUrl(args.menuUrl),
    cuisineTags: normalizeTagList(args.cuisineTags),
    dietaryTags: normalizeTagList(args.dietaryTags),
  };
}

function canManageRestaurant(user: Record<string, any>, restaurant: Record<string, any>) {
  return user.role === "moderator" || String(restaurant.ownerUserId || "") === String(user._id);
}

function canViewRestaurant(user: Record<string, any> | null | undefined, restaurant: Record<string, any>) {
  if (!restaurant.isHidden) {
    return true;
  }

  if (!user) {
    return false;
  }

  return user.role === "moderator" || String(restaurant.ownerUserId || "") === String(user._id);
}

async function buildReviewsView(ctx: any, restaurantId: any, currentUserId?: any, currentUserRole?: string) {
  const reviews = await ctx.db
    .query("reviews")
    .withIndex("by_restaurant_id", (query: any) => query.eq("restaurantId", restaurantId))
    .collect();

  const authorIds = Array.from(
    new Map(reviews.map((review: any) => [String(review.userId), review.userId])).values(),
  );
  const users = await Promise.all(authorIds.map((userId) => ctx.db.get(userId)));
  const userMap = new Map(users.filter(Boolean).map((user) => [String(user._id), user]));

  const sortedReviews = [...reviews].sort((left, right) =>
    String(right.updatedAt || right.createdAt).localeCompare(String(left.updatedAt || left.createdAt)),
  );

  return sortedReviews.map((review) => {
    const author = userMap.get(String(review.userId));
    return {
      id: review._id,
      rating: review.rating,
      comment: review.comment,
      createdAt: review.createdAt,
      updatedAt: review.updatedAt,
      authorId: String(review.userId),
      authorName: author?.displayName || "Nearby Bites User",
      authorRole: author?.role || "customer",
      canDelete:
        String(currentUserId || "") === String(review.userId) || currentUserRole === "moderator",
    };
  });
}

export const listNearby = queryGeneric({
  args: {
    lat: v.number(),
    lng: v.number(),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
    dietary: v.optional(v.array(v.string())),
    radiusMeters: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const [restaurants, allReviews] = await Promise.all([
      ctx.db.query("restaurants").collect(),
      ctx.db.query("reviews").collect(),
    ]);

    const dietaryFilters = (args.dietary || []).map(normalizeTag);
    const reviewStats = buildReviewStats(allReviews);
    const offset = Number.parseInt(String(args.cursor || "0"), 10) || 0;
    const limit = Math.max(1, Math.min(20, Number(args.limit || 20)));
    const radiusKm = Math.max(0.1, Number(args.radiusMeters || 3000) / 1000);

    let items = restaurants
      .map((restaurant) =>
        buildRestaurantSummary(restaurant, { lat: args.lat, lng: args.lng }, reviewStats),
      )
      .filter((restaurant) => {
        if (restaurant.isHidden) {
          return false;
        }

        if (restaurant.source === "fallback") {
          return false;
        }

        if (restaurant.source === "google") {
          return false;
        }

        if (restaurant.distanceKm > radiusKm) {
          return false;
        }

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
    sessionToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [restaurant, currentSession] = await Promise.all([
      ctx.db.get(args.id),
      resolveSession(ctx, args.sessionToken),
    ]);

    if (!restaurant) {
      return null;
    }
    if (!canViewRestaurant(currentSession?.user, restaurant)) {
      return null;
    }

    const origin = {
      lat: Number.isFinite(args.originLat) ? args.originLat : restaurant.lat,
      lng: Number.isFinite(args.originLng) ? args.originLng : restaurant.lng,
    };

    const [allReviews, detailedReviews] = await Promise.all([
      ctx.db.query("reviews").collect(),
      buildReviewsView(ctx, args.id, currentSession?.user?._id, currentSession?.user?.role),
    ]);
    const reviewStats = buildReviewStats(allReviews);
    const detail = buildRestaurantSummary(restaurant, origin, reviewStats);
    const myReview =
      detailedReviews.find((review) => String(review.authorId) === String(currentSession?.user?._id)) ||
      null;

    return {
      restaurant: detail,
      images: restaurant.images || [],
      menuItems: restaurant.menuItems || [],
      reviews: detailedReviews,
      myReview,
      permissions: {
        canReview: Boolean(currentSession?.user),
        canManage: currentSession?.user
          ? canManageRestaurant(currentSession.user, restaurant)
          : false,
        canModerate: currentSession?.user?.role === "moderator",
      },
    };
  },
});

export const listManagedRestaurants = queryGeneric({
  args: {
    sessionToken: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx, args.sessionToken);
    const [restaurants, allReviews] = await Promise.all([
      user.role === "moderator"
        ? ctx.db.query("restaurants").collect()
        : ctx.db
            .query("restaurants")
            .withIndex("by_owner_user_id", (query) => query.eq("ownerUserId", user._id))
            .collect(),
      ctx.db.query("reviews").collect(),
    ]);
    const reviewStats = buildReviewStats(allReviews);

    return restaurants
      .map((restaurant) =>
        buildRestaurantSummary(restaurant, { lat: restaurant.lat, lng: restaurant.lng }, reviewStats),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
  },
});

export const createRestaurant = mutationGeneric({
  args: {
    sessionToken: v.string(),
    name: v.string(),
    address: v.string(),
    description: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    openingHours: v.optional(v.string()),
    menuUrl: v.optional(v.string()),
    cuisineTags: v.optional(v.array(v.string())),
    dietaryTags: v.optional(v.array(v.string())),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireRole(ctx, args.sessionToken, ["owner", "moderator"]);
    const input = normalizeRestaurantInput(args);
    const lat = Number(args.lat);
    const lng = Number(args.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("Choose a verified restaurant location before creating it.");
    }

    const restaurantId = await ctx.db.insert("restaurants", {
      ...input,
      lat: normalizeLatLng(lat, lat),
      lng: normalizeLatLng(lng, lng),
      source: "manual",
      syncStatus: "complete",
      lastSyncedAt: nowIso(),
      coverImage: null,
      images: [],
      menuItems: [],
      googleMapsUri: null,
      primaryType: null,
      isHidden: false,
      hiddenReason: null,
      hiddenAt: null,
      hiddenByUserId: undefined,
      ownerUserId: user._id,
      createdByUserId: user._id,
      googlePlaceId: null,
      googleRating: null,
      googleRatingCount: 0,
    });

    return { restaurantId };
  },
});

export const updateRestaurant = mutationGeneric({
  args: {
    sessionToken: v.string(),
    restaurantId: v.id("restaurants"),
    name: v.string(),
    address: v.string(),
    description: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    openingHours: v.optional(v.string()),
    menuUrl: v.optional(v.string()),
    cuisineTags: v.optional(v.array(v.string())),
    dietaryTags: v.optional(v.array(v.string())),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireRole(ctx, args.sessionToken, ["owner", "moderator"]);
    const restaurant = await ctx.db.get(args.restaurantId);
    if (!restaurant) {
      throw new Error("Restaurant not found.");
    }

    if (!canManageRestaurant(user, restaurant)) {
      throw new Error("You do not have permission to update that restaurant.");
    }

    const input = normalizeRestaurantInput(args);
    const lat = Number(args.lat);
    const lng = Number(args.lng);
    await ctx.db.patch(args.restaurantId, {
      ...input,
      lat: Number.isFinite(lat) ? normalizeLatLng(lat, restaurant.lat) : restaurant.lat,
      lng: Number.isFinite(lng) ? normalizeLatLng(lng, restaurant.lng) : restaurant.lng,
      lastSyncedAt: nowIso(),
    });

    return { restaurantId: args.restaurantId };
  },
});

export const deleteRestaurant = mutationGeneric({
  args: {
    sessionToken: v.string(),
    restaurantId: v.id("restaurants"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireRole(ctx, args.sessionToken, ["owner", "moderator"]);
    const restaurant = await ctx.db.get(args.restaurantId);
    if (!restaurant) {
      throw new Error("Restaurant not found.");
    }

    if (!canManageRestaurant(user, restaurant)) {
      throw new Error("You do not have permission to delete that restaurant.");
    }

    await deleteRestaurantTree(ctx, args.restaurantId);
    return { deletedRestaurantId: args.restaurantId };
  },
});

export const setRestaurantVisibility = mutationGeneric({
  args: {
    sessionToken: v.string(),
    restaurantId: v.id("restaurants"),
    isHidden: v.boolean(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireRole(ctx, args.sessionToken, ["moderator"]);
    const restaurant = await ctx.db.get(args.restaurantId);
    if (!restaurant) {
      throw new Error("Restaurant not found.");
    }

    await ctx.db.patch(args.restaurantId, {
      isHidden: args.isHidden,
      hiddenReason: args.isHidden ? normalizeOptionalString(args.reason, 300) : null,
      hiddenAt: args.isHidden ? nowIso() : null,
      hiddenByUserId: args.isHidden ? user._id : undefined,
    });

    return {
      restaurantId: args.restaurantId,
      isHidden: args.isHidden,
    };
  },
});

export const addMenuItem = mutationGeneric({
  args: {
    sessionToken: v.string(),
    restaurantId: v.id("restaurants"),
    name: v.string(),
    description: v.optional(v.string()),
    price: v.number(),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireRole(ctx, args.sessionToken, ["owner", "moderator"]);
    const restaurant = await ctx.db.get(args.restaurantId);
    if (!restaurant) {
      throw new Error("Restaurant not found.");
    }

    if (!canManageRestaurant(user, restaurant)) {
      throw new Error("You do not have permission to edit that menu.");
    }

    const name = normalizeOptionalString(args.name, 120);
    if (!name) {
      throw new Error("Menu item name is required.");
    }

    const menuItems = [...(restaurant.menuItems || [])];
    menuItems.push({
      name,
      description: normalizeOptionalString(args.description, 500),
      price: normalizePrice(args.price),
      imageUrl: normalizeHttpUrl(args.imageUrl),
    });

    await ctx.db.patch(args.restaurantId, {
      menuItems,
      lastSyncedAt: nowIso(),
    });

    return { restaurantId: args.restaurantId, menuItemsCount: menuItems.length };
  },
});

export const addRestaurantImage = mutationGeneric({
  args: {
    sessionToken: v.string(),
    restaurantId: v.id("restaurants"),
    imageUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const { user } = await requireRole(ctx, args.sessionToken, ["owner", "moderator"]);
    const restaurant = await ctx.db.get(args.restaurantId);
    if (!restaurant) {
      throw new Error("Restaurant not found.");
    }

    if (!canManageRestaurant(user, restaurant)) {
      throw new Error("You do not have permission to edit that restaurant.");
    }

    const imageUrl = normalizeHttpUrl(args.imageUrl);
    if (!imageUrl) {
      throw new Error("Provide an image URL to add.");
    }

    const images = [...(restaurant.images || []), { url: imageUrl, isCover: !(restaurant.images || []).length }];
    await ctx.db.patch(args.restaurantId, {
      images,
      coverImage: restaurant.coverImage || imageUrl,
      lastSyncedAt: nowIso(),
    });

    return { restaurantId: args.restaurantId, imagesCount: images.length };
  },
});
