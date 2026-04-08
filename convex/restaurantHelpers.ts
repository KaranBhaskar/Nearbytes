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

export function normalizeTag(tag: string) {
  const normalized = String(tag || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  return normalized === "gluten_free" ? "gluten-free" : normalized;
}

export function buildReviewStats(reviews: Array<Record<string, any>>) {
  const stats = new Map<string, { rating: number; count: number }>();

  for (const review of reviews) {
    const key = String(review.restaurantId);
    const current = stats.get(key) || { rating: 0, count: 0 };
    current.rating += Number(review.rating || 0);
    current.count += 1;
    stats.set(key, current);
  }

  return stats;
}

export function buildRestaurantSummary(
  restaurant: Record<string, any>,
  origin: { lat: number; lng: number },
  reviewStats: Map<string, { rating: number; count: number }> = new Map(),
) {
  const googleRating = restaurant.googleRating ?? null;
  const googleRatingCount = Number(restaurant.googleRatingCount || 0);
  const reviewSummary = reviewStats.get(String(restaurant._id)) || { rating: 0, count: 0 };
  const appRating =
    reviewSummary.count > 0 ? Number((reviewSummary.rating / reviewSummary.count).toFixed(1)) : null;
  const appRatingCount = reviewSummary.count;
  const combinedCount = googleRatingCount + appRatingCount;
  const combinedTotal =
    (googleRating || 0) * googleRatingCount + (appRating || 0) * appRatingCount;
  const combinedRating = combinedCount > 0 ? Number((combinedTotal / combinedCount).toFixed(1)) : null;
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
    ownerUserId: restaurant.ownerUserId || null,
    createdByUserId: restaurant.createdByUserId || null,
    googleRating,
    googleRatingCount,
    appRating,
    appRatingCount,
    combinedRating,
    combinedRatingCount: combinedCount,
    distanceKm: haversineKm(origin.lat, origin.lng, restaurant.lat, restaurant.lng),
  };
}

export async function deleteRestaurantTree(ctx: any, restaurantId: any) {
  const [favorites, reviews] = await Promise.all([
    ctx.db
      .query("favorites")
      .withIndex("by_restaurant_id", (query: any) => query.eq("restaurantId", restaurantId))
      .collect(),
    ctx.db
      .query("reviews")
      .withIndex("by_restaurant_id", (query: any) => query.eq("restaurantId", restaurantId))
      .collect(),
  ]);

  for (const favorite of favorites) {
    await ctx.db.delete(favorite._id);
  }

  for (const review of reviews) {
    await ctx.db.delete(review._id);
  }

  await ctx.db.delete(restaurantId);
}

