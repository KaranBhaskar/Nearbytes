import { demoRestaurants } from "./demo-restaurants.js";

const CONVEX_FUNCTIONS = {
  ensureFallbackRestaurants: "restaurants:ensureFallbackRestaurants",
  getRestaurantDetail: "restaurants:getRestaurantDetail",
  listNearby: "restaurants:listNearby",
  listManagedRestaurants: "restaurants:listManagedRestaurants",
  createRestaurant: "restaurants:createRestaurant",
  updateRestaurant: "restaurants:updateRestaurant",
  deleteRestaurant: "restaurants:deleteRestaurant",
  addRestaurantImage: "restaurants:addRestaurantImage",
  addMenuItem: "restaurants:addMenuItem",
  signUp: "auth:signUp",
  signIn: "auth:signIn",
  signOut: "auth:signOut",
  getCurrentUser: "auth:getCurrentUser",
  listUsers: "auth:listUsers",
  deleteUser: "auth:deleteUser",
  listFavoriteRestaurantIds: "favorites:listFavoriteRestaurantIds",
  setFavorite: "favorites:setFavorite",
  syncFavoriteRestaurantIds: "favorites:syncFavoriteRestaurantIds",
  upsertReview: "reviews:upsertReview",
  deleteReview: "reviews:deleteReview",
};

const STORAGE_KEYS = {
  sessionToken: "nearbyBites.sessionToken",
};

let convexClientPromise = null;
let forceLocalMode = false;
let localRestaurants = [];
let localSeedEnsured = false;
let fallbackSeedPromise = null;

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

function getStoredSessionToken() {
  return String(localStorage.getItem(STORAGE_KEYS.sessionToken) || "").trim();
}

function storeSessionToken(sessionToken) {
  if (sessionToken) {
    localStorage.setItem(STORAGE_KEYS.sessionToken, sessionToken);
    return;
  }

  localStorage.removeItem(STORAGE_KEYS.sessionToken);
}

function looksLikeConvexId(value) {
  return typeof value === "string" && value.length > 12 && !value.startsWith("demo-");
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
    ownerUserId: restaurant.ownerUserId || null,
    googleRating,
    googleRatingCount,
    appRating: restaurant.appRating ?? null,
    appRatingCount: Number(restaurant.appRatingCount || 0),
    combinedRating: restaurant.combinedRating ?? googleRating,
    combinedRatingCount: Number(restaurant.combinedRatingCount || googleRatingCount),
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

async function runQuery(functionName, args = {}) {
  const convexLib = await loadConvexBundle();
  const convexClient = await getConvexClient();
  if (!convexClient) {
    throw new Error("Convex backend is not available.");
  }

  return convexClient.query(getFunctionReference(convexLib, functionName), args);
}

async function runMutation(functionName, args = {}) {
  const convexLib = await loadConvexBundle();
  const convexClient = await getConvexClient();
  if (!convexClient) {
    throw new Error("Convex backend is not available.");
  }

  return convexClient.mutation(getFunctionReference(convexLib, functionName), args);
}

async function ensureFallbackSeededOnce() {
  if (!fallbackSeedPromise) {
    fallbackSeedPromise = runMutation(CONVEX_FUNCTIONS.ensureFallbackRestaurants).catch((error) => {
      fallbackSeedPromise = null;
      throw error;
    });
  }

  return fallbackSeedPromise;
}

async function withProvider(convexHandler, localHandler) {
  if (!forceLocalMode && hasConvexConfig()) {
    try {
      return await convexHandler();
    } catch (error) {
      forceLocalMode = true;
      console.warn("Falling back to local restaurant data:", error);
    }
  }

  return localHandler();
}

function getRequiredSessionToken() {
  const sessionToken = getStoredSessionToken();
  if (!sessionToken) {
    throw new Error("Please sign in to continue.");
  }

  return sessionToken;
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

export function clearStoredSession() {
  storeSessionToken("");
}

export async function restoreSession() {
  if (!hasConvexConfig() || forceLocalMode) {
    return null;
  }

  const sessionToken = getStoredSessionToken();
  if (!sessionToken) {
    return null;
  }

  try {
    const user = await runQuery(CONVEX_FUNCTIONS.getCurrentUser, { sessionToken });
    if (!user) {
      clearStoredSession();
      return null;
    }

    return user;
  } catch (_error) {
    clearStoredSession();
    return null;
  }
}

export async function signUpUser({ displayName, email, password, role }) {
  const result = await runMutation(CONVEX_FUNCTIONS.signUp, {
    displayName,
    email,
    password,
    role,
  });
  storeSessionToken(result.sessionToken);
  return result.user;
}

export async function signInUser({ email, password }) {
  const result = await runMutation(CONVEX_FUNCTIONS.signIn, {
    email,
    password,
  });
  storeSessionToken(result.sessionToken);
  return result.user;
}

export async function signOutUser() {
  const sessionToken = getStoredSessionToken();
  try {
    if (sessionToken && !forceLocalMode && hasConvexConfig()) {
      await runMutation(CONVEX_FUNCTIONS.signOut, { sessionToken });
    }
  } finally {
    clearStoredSession();
  }
}

export async function hydrateFavoriteIds(localFavorites = []) {
  const sessionToken = getStoredSessionToken();
  if (!sessionToken || forceLocalMode || !hasConvexConfig()) {
    return localFavorites.map(String);
  }

  const validLocalFavorites = localFavorites.filter(looksLikeConvexId);
  if (validLocalFavorites.length) {
    const merged = await runMutation(CONVEX_FUNCTIONS.syncFavoriteRestaurantIds, {
      sessionToken,
      restaurantIds: validLocalFavorites,
    });
    return merged.map(String);
  }

  const favorites = await runQuery(CONVEX_FUNCTIONS.listFavoriteRestaurantIds, {
    sessionToken,
  });

  return favorites.map(String);
}

export async function setFavoriteRestaurant({ restaurantId, isFavorite }) {
  const sessionToken = getRequiredSessionToken();
  await runMutation(CONVEX_FUNCTIONS.setFavorite, {
    sessionToken,
    restaurantId,
    isFavorite,
  });
}

export async function listNearbyRestaurants({ lat, lng, limit = 20, cursor, dietary = [] }) {
  return withProvider(
    async () => {
      let result = await runQuery(CONVEX_FUNCTIONS.listNearby, {
        lat,
        lng,
        limit,
        cursor,
        dietary,
      });

      if (!result || !Array.isArray(result.items)) {
        throw new Error("Restaurant data is unavailable right now.");
      }

      if (result.total === 0) {
        await ensureFallbackSeededOnce();
        result = await runQuery(CONVEX_FUNCTIONS.listNearby, {
          lat,
          lng,
          limit,
          cursor,
          dietary,
        });
      }

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
    async () =>
      runQuery(CONVEX_FUNCTIONS.getRestaurantDetail, {
        id,
        originLat,
        originLng,
        sessionToken: getStoredSessionToken() || undefined,
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
        permissions: {
          canReview: false,
          canManage: false,
          canModerate: false,
        },
      };
    },
  );
}

export async function upsertRestaurantReview({ restaurantId, rating, comment }) {
  const sessionToken = getRequiredSessionToken();
  return runMutation(CONVEX_FUNCTIONS.upsertReview, {
    sessionToken,
    restaurantId,
    rating,
    comment,
  });
}

export async function deleteRestaurantReview({ reviewId }) {
  const sessionToken = getRequiredSessionToken();
  return runMutation(CONVEX_FUNCTIONS.deleteReview, {
    sessionToken,
    reviewId,
  });
}

export async function listManagedRestaurants() {
  const sessionToken = getRequiredSessionToken();
  return runQuery(CONVEX_FUNCTIONS.listManagedRestaurants, { sessionToken });
}

export async function createManagedRestaurant(payload) {
  const sessionToken = getRequiredSessionToken();
  return runMutation(CONVEX_FUNCTIONS.createRestaurant, {
    sessionToken,
    ...payload,
  });
}

export async function updateManagedRestaurant(payload) {
  const sessionToken = getRequiredSessionToken();
  return runMutation(CONVEX_FUNCTIONS.updateRestaurant, {
    sessionToken,
    ...payload,
  });
}

export async function deleteManagedRestaurant(restaurantId) {
  const sessionToken = getRequiredSessionToken();
  return runMutation(CONVEX_FUNCTIONS.deleteRestaurant, {
    sessionToken,
    restaurantId,
  });
}

export async function addManagedRestaurantImage(payload) {
  const sessionToken = getRequiredSessionToken();
  return runMutation(CONVEX_FUNCTIONS.addRestaurantImage, {
    sessionToken,
    ...payload,
  });
}

export async function addManagedMenuItem(payload) {
  const sessionToken = getRequiredSessionToken();
  return runMutation(CONVEX_FUNCTIONS.addMenuItem, {
    sessionToken,
    ...payload,
  });
}

export async function listModerationUsers() {
  const sessionToken = getRequiredSessionToken();
  return runQuery(CONVEX_FUNCTIONS.listUsers, { sessionToken });
}

export async function deleteModerationUser(userId) {
  const sessionToken = getRequiredSessionToken();
  return runMutation(CONVEX_FUNCTIONS.deleteUser, {
    sessionToken,
    userId,
  });
}
