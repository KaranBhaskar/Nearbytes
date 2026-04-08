import { demoRestaurants } from "./demo-restaurants.js";

const CONVEX_FUNCTIONS = {
  ensureFallbackRestaurants: "restaurants:ensureFallbackRestaurants",
  getRestaurantDetail: "restaurants:getRestaurantDetail",
  listNearby: "restaurants:listNearby",
};

let convexClientPromise = null;
let forceLocalMode = false;
let localRestaurants = [];
let localSeedEnsured = false;

function cloneDeep(value) {
  return JSON.parse(JSON.stringify(value));
}

function getRuntimeConfig() {
  return window.__APP_CONFIG__ || {};
}

function hasConvexConfig() {
  return Boolean(String(getRuntimeConfig().convexUrl || "").trim());
}

function getFunctionReference(convexLib, functionName) {
  return convexLib.makeFunctionReference(functionName);
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeDietaryTag(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
  return normalized === "gluten_free" ? "gluten-free" : normalized;
}

function buildRestaurantSummary(restaurant, origin) {
  const googleRating = restaurant.googleRating ?? null;
  const googleRatingCount = Number(restaurant.googleRatingCount || 0);
  const coverImage =
    restaurant.coverImage ||
    (Array.isArray(restaurant.images)
      ? restaurant.images.find((image) => image.isCover)?.url || null
      : null);

  return {
    id: restaurant.id,
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

function ensureLocalRestaurants() {
  if (!localSeedEnsured) {
    localRestaurants = cloneDeep(demoRestaurants);
    localSeedEnsured = true;
  }

  return localRestaurants;
}

async function loadConvexBundle() {
  if (window.convex && typeof window.convex.ConvexClient === "function") {
    return window.convex;
  }
  throw new Error("Convex browser SDK failed to load.");
}

async function getConvexClient() {
  if (forceLocalMode || !hasConvexConfig()) {
    return null;
  }

  if (!convexClientPromise) {
    convexClientPromise = (async () => {
      const convexLib = await loadConvexBundle();
      return new convexLib.ConvexClient(getRuntimeConfig().convexUrl);
    })();
  }

  return convexClientPromise;
}

async function withProvider(convexHandler, localHandler) {
  if (!forceLocalMode && hasConvexConfig()) {
    try {
      const convexLib = await loadConvexBundle();
      const convexClient = await getConvexClient();
      if (convexClient) {
        return await convexHandler({ convexClient, convexLib });
      }
    } catch (error) {
      forceLocalMode = true;
      console.warn("Falling back to local restaurant data:", error);
    }
  }

  return localHandler();
}

export function getRestaurantDataMode() {
  if (forceLocalMode) {
    return "local";
  }

  return hasConvexConfig() ? "convex" : "local";
}

export function getRestaurantDataModeLabel() {
  return getRestaurantDataMode() === "convex" ? "Convex backend" : "local demo data";
}

export async function listNearbyRestaurants({ lat, lng, limit = 20, cursor, dietary = [] }) {
  return withProvider(
    async ({ convexClient, convexLib }) => {
      const result = await convexClient.query(getFunctionReference(convexLib, CONVEX_FUNCTIONS.listNearby), {
        lat,
        lng,
        limit,
        cursor,
        dietary,
      });

      if (!result || !Array.isArray(result.items) || result.total === 0) {
        forceLocalMode = true;
        return listNearbyRestaurants({ lat, lng, limit, cursor, dietary });
      }

      return result;
    },
    async () => {
      const restaurants = ensureLocalRestaurants();
      const filters = dietary.map(normalizeDietaryTag);
      const offset = Number.parseInt(String(cursor || "0"), 10) || 0;

      const items = restaurants
        .map((restaurant) => buildRestaurantSummary(restaurant, { lat, lng }))
        .filter((restaurant) => {
          if (!filters.length) {
            return true;
          }

          const restaurantTags = (restaurant.dietaryTags || []).map(normalizeDietaryTag);
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

          return filters.every((tag) => {
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
  );
}

export async function getRestaurantDetails({ id, originLat, originLng }) {
  return withProvider(
    async ({ convexClient, convexLib }) =>
      convexClient.query(getFunctionReference(convexLib, CONVEX_FUNCTIONS.getRestaurantDetail), {
        id,
        originLat,
        originLng,
      }),
    async () => {
      const restaurants = ensureLocalRestaurants();
      const restaurant = restaurants.find((item) => item.id === id);
      if (!restaurant) {
        return null;
      }

      const detail = buildRestaurantSummary(restaurant, {
        lat: Number.isFinite(originLat) ? originLat : restaurant.lat,
        lng: Number.isFinite(originLng) ? originLng : restaurant.lng,
      });

      return {
        restaurant: detail,
        images: restaurant.images || [],
        menuItems: restaurant.menuItems || [],
        reviews: [],
        myReview: null,
      };
    },
  );
}
