"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  buildNearbyCacheKey,
  getNearbyRadiusMeters,
  isCacheFresh,
  OSM_MAX_RADIUS_METERS,
  OSM_MIN_RESULTS,
  OSM_TARGET_RESULTS,
} from "./googleHelpers";
import { normalizeHttpUrl, normalizeOptionalString, nowIso } from "./authHelpers";
import { normalizeTag } from "./restaurantHelpers";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";
const APP_USER_AGENT = "Nearbytes/1.0 (OpenStreetMap restaurant lookup)";

function splitTags(value: unknown) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/[;,]/)
        .map((entry) => normalizeTag(entry))
        .filter(Boolean),
    ),
  );
}

function hasTruthyDietaryValue(value: unknown) {
  return ["yes", "only", "limited", "true", "1"].includes(
    String(value || "").trim().toLowerCase(),
  );
}

function safeNormalizeHttpUrl(value: unknown) {
  try {
    return normalizeHttpUrl(value);
  } catch (_error) {
    return null;
  }
}

function inferOsmCuisineTags(tags: Record<string, any>) {
  const inferred = new Set<string>(splitTags(tags.cuisine));
  const amenity = normalizeTag(tags.amenity);
  const name = String(tags.name || "").toLowerCase();

  if (amenity === "cafe") {
    inferred.add("cafe");
    inferred.add("coffee");
  }
  if (amenity === "fast-food") {
    inferred.add("fast-food");
    inferred.add("quick-bites");
  }
  if (amenity === "food-court") {
    inferred.add("food-court");
    inferred.add("quick-bites");
  }

  const keywordRules = [
    { tag: "pizza", patterns: ["pizza"] },
    { tag: "burgers", patterns: ["burger", "burgers"] },
    { tag: "coffee", patterns: ["coffee", "espresso", "starbucks", "tim hortons"] },
    { tag: "donuts", patterns: ["donut", "doughnut", "tim hortons"] },
    { tag: "sandwiches", patterns: ["sandwich", "subway", "subs"] },
    { tag: "shawarma", patterns: ["shawarma", "osmow", "kebab"] },
    { tag: "sushi", patterns: ["sushi"] },
    { tag: "ramen", patterns: ["ramen"] },
    { tag: "bakery", patterns: ["bakery", "bake"] },
  ];

  for (const rule of keywordRules) {
    if (rule.patterns.some((pattern) => name.includes(pattern))) {
      inferred.add(rule.tag);
    }
  }

  return Array.from(inferred);
}

function inferOsmDietaryTags(tags: Record<string, any>) {
  const dietaryTags = new Set<string>();
  const searchableText = Object.values(tags).filter(Boolean).join(" ").toLowerCase();
  const cuisineText = String(tags.cuisine || "").toLowerCase();
  const nameText = String(tags.name || "").toLowerCase();
  const combinedText = `${nameText} ${cuisineText} ${searchableText}`;

  if (hasTruthyDietaryValue(tags["diet:vegan"]) || combinedText.includes("vegan")) {
    dietaryTags.add("vegan");
  }
  if (
    hasTruthyDietaryValue(tags["diet:vegetarian"]) ||
    combinedText.includes("vegetarian")
  ) {
    dietaryTags.add("vegetarian");
  }
  if (hasTruthyDietaryValue(tags["diet:halal"]) || combinedText.includes("halal")) {
    dietaryTags.add("halal");
  }
  if (hasTruthyDietaryValue(tags["diet:kosher"]) || combinedText.includes("kosher")) {
    dietaryTags.add("kosher");
  }
  if (
    hasTruthyDietaryValue(tags["diet:gluten_free"]) ||
    hasTruthyDietaryValue(tags["diet:gluten-free"]) ||
    combinedText.includes("gluten free") ||
    combinedText.includes("gluten-free")
  ) {
    dietaryTags.add("gluten-free");
  }

  if (
    combinedText.includes("salad") ||
    combinedText.includes("veggie") ||
    combinedText.includes("plant-based") ||
    combinedText.includes("indian") ||
    combinedText.includes("mediterranean") ||
    combinedText.includes("middle eastern") ||
    combinedText.includes("falafel")
  ) {
    dietaryTags.add("vegetarian");
  }
  if (
    combinedText.includes("shawarma") ||
    combinedText.includes("kebab") ||
    combinedText.includes("gyro")
  ) {
    dietaryTags.add("halal");
  }
  if (dietaryTags.has("vegan")) {
    dietaryTags.add("vegetarian");
  }

  return Array.from(dietaryTags);
}

function buildOsmAddress(tags: Record<string, any>) {
  const city = tags["addr:city"] || tags["addr:town"] || tags["addr:village"];
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    city,
    tags["addr:state"],
    tags["addr:postcode"],
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+,/g, ",")
    .trim();

  return parts || tags["addr:full"] || city || "Address unavailable";
}

function getOsmElementLatLng(element: any) {
  return {
    lat: Number(element?.lat ?? element?.center?.lat),
    lng: Number(element?.lon ?? element?.center?.lon),
  };
}

async function fetchOverpassRestaurants(lat: number, lng: number, radiusMeters: number) {
  const query = `
[out:json][timeout:25];
(
  node["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${Math.round(radiusMeters)},${lat},${lng});
  way["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${Math.round(radiusMeters)},${lat},${lng});
  relation["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${Math.round(radiusMeters)},${lat},${lng});
);
out center tags;
`;

  const response = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": APP_USER_AGENT,
    },
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`OpenStreetMap restaurant sync failed: ${payload || response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.elements) ? payload.elements : [];
}

async function fetchExpandedOsmRestaurants(lat: number, lng: number, radiusMeters: number) {
  let effectiveRadius = Math.max(1000, Math.round(radiusMeters));
  const uniqueElements = new Map<string, any>();

  while (effectiveRadius <= OSM_MAX_RADIUS_METERS) {
    const elements = await fetchOverpassRestaurants(lat, lng, effectiveRadius);
    for (const element of elements) {
      const key = `${element?.type}:${element?.id}`;
      if (element?.id != null && !uniqueElements.has(key)) {
        uniqueElements.set(key, element);
      }
    }

    if (uniqueElements.size >= OSM_MIN_RESULTS || effectiveRadius >= OSM_MAX_RADIUS_METERS) {
      break;
    }

    effectiveRadius = Math.min(effectiveRadius * 2, OSM_MAX_RADIUS_METERS);
  }

  return {
    elements: Array.from(uniqueElements.values()).slice(0, OSM_TARGET_RESULTS),
    effectiveRadius,
  };
}

function normalizeOsmRestaurant(element: any, syncedAt: string) {
  const tags = element?.tags || {};
  const name = normalizeOptionalString(tags.name, 120);
  const { lat, lng } = getOsmElementLatLng(element);
  const osmType = String(element?.type || "").trim();
  const osmId = String(element?.id || "").trim();

  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || !osmType || !osmId) {
    return null;
  }

  const osmUri = `https://www.openstreetmap.org/${encodeURIComponent(osmType)}/${encodeURIComponent(osmId)}`;

  return {
    googlePlaceId: `osm:${osmType}:${osmId}`,
    source: "openstreetmap",
    syncStatus: "complete",
    lastSyncedAt: syncedAt,
    name,
    address: normalizeOptionalString(buildOsmAddress(tags), 240) || "Address unavailable",
    lat,
    lng,
    description: normalizeOptionalString(tags.description || tags["description:en"], 1500),
    phone: normalizeOptionalString(tags.phone || tags["contact:phone"], 80),
    website: safeNormalizeHttpUrl(tags.website || tags["contact:website"]),
    googleMapsUri: osmUri,
    openingHours: normalizeOptionalString(tags.opening_hours, 400),
    menuUrl: safeNormalizeHttpUrl(tags.menu || tags["contact:menu"]),
    primaryType: normalizeOptionalString(tags.amenity, 120),
    cuisineTags: inferOsmCuisineTags(tags),
    dietaryTags: inferOsmDietaryTags(tags),
    coverImage: null,
    images: [],
    menuItems: [],
    googleRating: null,
    googleRatingCount: 0,
  };
}

export const syncNearbyFromGoogle = action({
  args: {
    lat: v.number(),
    lng: v.number(),
    radiusMeters: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const radiusMeters = Number(args.radiusMeters || getNearbyRadiusMeters());
    const cacheKey = buildNearbyCacheKey(args.lat, args.lng, radiusMeters);
    const syncedAt = nowIso();
    const existingCache = await ctx.runQuery(internal.googleSyncStore.getNearbySyncCache, {
      cacheKey,
    });

    if (!args.force && existingCache?.status === "complete" && isCacheFresh(existingCache.lastSyncedAt)) {
      return {
        status: "cached",
        cacheKey,
        itemCount: existingCache.itemCount,
        lastSyncedAt: existingCache.lastSyncedAt,
      };
    }

    try {
      const { elements, effectiveRadius } = await fetchExpandedOsmRestaurants(
        args.lat,
        args.lng,
        radiusMeters,
      );
      const restaurants = elements
        .map((element) => normalizeOsmRestaurant(element, syncedAt))
        .filter(Boolean);

      const result = await ctx.runMutation(internal.googleSyncStore.upsertGoogleRestaurants, {
        restaurants,
      });
      await ctx.runMutation(internal.googleSyncStore.recordNearbySyncResult, {
        cacheKey,
        centerLat: args.lat,
        centerLng: args.lng,
        radiusMeters: effectiveRadius,
        status: "complete",
        source: "openstreetmap",
        itemCount: restaurants.length,
        lastAttemptAt: syncedAt,
        lastSyncedAt: syncedAt,
        errorMessage: null,
      });

      return {
        status: "complete",
        cacheKey,
        itemCount: restaurants.length,
        radiusMeters: effectiveRadius,
        inserted: result.inserted,
        updated: result.updated,
      };
    } catch (error: any) {
      const message = String(error?.message || "Unknown OpenStreetMap sync error");
      await ctx.runMutation(internal.googleSyncStore.recordNearbySyncResult, {
        cacheKey,
        centerLat: args.lat,
        centerLng: args.lng,
        radiusMeters,
        status: "error",
        source: "openstreetmap",
        itemCount: 0,
        lastAttemptAt: syncedAt,
        lastSyncedAt: existingCache?.lastSyncedAt || null,
        errorMessage: message,
      });

      return {
        status: "error",
        cacheKey,
        reason: message,
      };
    }
  },
});

export const enrichRestaurantTags = action({
  args: {
    restaurantIds: v.array(v.id("restaurants")),
  },
  handler: async () => {
    return { updated: [] };
  },
});
