const CONVEX_FUNCTIONS = {
  getRestaurantDetail: "restaurants:getRestaurantDetail",
  listNearby: "restaurants:listNearby",
  syncNearbyFromGoogle: "googlePlaces:syncNearbyFromGoogle",
  enrichRestaurantTags: "googlePlaces:enrichRestaurantTags",
  geocodeSearch: "googleMaps:geocodeSearch",
  reverseGeocode: "googleMaps:reverseGeocode",
  listManagedRestaurants: "restaurants:listManagedRestaurants",
  createRestaurant: "restaurants:createRestaurant",
  updateRestaurant: "restaurants:updateRestaurant",
  deleteRestaurant: "restaurants:deleteRestaurant",
  setRestaurantVisibility: "restaurants:setRestaurantVisibility",
  addRestaurantImage: "restaurants:addRestaurantImage",
  addMenuItem: "restaurants:addMenuItem",
  signUp: "auth:signUp",
  signIn: "auth:signIn",
  signOut: "auth:signOut",
  getCurrentUser: "auth:getCurrentUser",
  listUsers: "auth:listUsers",
  deleteUser: "auth:deleteUser",
  setUserBan: "auth:setUserBan",
  listFavoriteRestaurantIds: "favorites:listFavoriteRestaurantIds",
  setFavorite: "favorites:setFavorite",
  syncFavoriteRestaurantIds: "favorites:syncFavoriteRestaurantIds",
  upsertReview: "reviews:upsertReview",
  deleteReview: "reviews:deleteReview",
  getMySearchState: "searchState:getMySearchState",
  saveMySearchState: "searchState:saveMySearchState",
};

const STORAGE_KEYS = {
  sessionToken: "nearbyBites.sessionToken",
};

let convexClientPromise = null;

function getRuntimeConfig() {
  return window.__APP_CONFIG__ || {};
}

function hasConvexConfig() {
  return Boolean(String(getRuntimeConfig().convexUrl || "").trim());
}

function requireConvexConfig() {
  if (!hasConvexConfig()) {
    throw new Error("Set CONVEX_URL to connect the app to your Convex deployment.");
  }
}

function getNearbyRadiusMeters() {
  const parsed = Number(getRuntimeConfig().nearbyRadiusMeters || 5000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
}

function getFunctionReference(convexLib, functionName) {
  return functionName;
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
  return typeof value === "string" && value.length > 12;
}

async function loadConvexBundle() {
  if (window.convex && typeof window.convex.ConvexHttpClient === "function") {
    return window.convex;
  }

  throw new Error("Convex browser SDK failed to load.");
}

async function getConvexClient() {
  requireConvexConfig();

  if (!convexClientPromise) {
    convexClientPromise = (async () => {
      const convexLib = await loadConvexBundle();
      return new convexLib.ConvexHttpClient(getRuntimeConfig().convexUrl, {
        logger: false,
      });
    })();
  }

  return convexClientPromise;
}

async function runQuery(functionName, args = {}) {
  const convexLib = await loadConvexBundle();
  const convexClient = await getConvexClient();
  return convexClient.query(getFunctionReference(convexLib, functionName), args);
}

async function runMutation(functionName, args = {}) {
  const convexLib = await loadConvexBundle();
  const convexClient = await getConvexClient();
  return convexClient.mutation(getFunctionReference(convexLib, functionName), args);
}

async function runAction(functionName, args = {}) {
  const convexLib = await loadConvexBundle();
  const convexClient = await getConvexClient();
  return convexClient.action(getFunctionReference(convexLib, functionName), args);
}

function getRequiredSessionToken() {
  const sessionToken = getStoredSessionToken();
  if (!sessionToken) {
    throw new Error("Please sign in to continue.");
  }

  return sessionToken;
}

export function getRestaurantDataMode() {
  return hasConvexConfig() ? "convex" : "unconfigured";
}

export function clearStoredSession() {
  storeSessionToken("");
}

export async function restoreSession() {
  if (!hasConvexConfig()) {
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
  requireConvexConfig();
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
  requireConvexConfig();
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
    if (sessionToken && hasConvexConfig()) {
      await runMutation(CONVEX_FUNCTIONS.signOut, { sessionToken });
    }
  } finally {
    clearStoredSession();
  }
}

export async function hydrateFavoriteIds(localFavorites = []) {
  if (!hasConvexConfig()) {
    return localFavorites.map(String);
  }

  const sessionToken = getStoredSessionToken();
  if (!sessionToken) {
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
  return runMutation(CONVEX_FUNCTIONS.setFavorite, {
    sessionToken,
    restaurantId,
    isFavorite,
  });
}

export async function listNearbyRestaurants({
  lat,
  lng,
  limit = 10,
  cursor,
  dietary = [],
  radiusMeters,
  forceSync = false,
}) {
  requireConvexConfig();

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Choose a location to load nearby restaurants.");
  }

  const effectiveRadiusMeters =
    Number.isFinite(Number(radiusMeters)) && Number(radiusMeters) > 0
      ? Number(radiusMeters)
      : getNearbyRadiusMeters();

  if (!cursor || forceSync) {
    try {
      await runAction(CONVEX_FUNCTIONS.syncNearbyFromGoogle, {
        lat,
        lng,
        radiusMeters: effectiveRadiusMeters,
      });
    } catch (error) {
      console.warn("Google Places sync failed, continuing with cached Convex data:", error);
    }
  }

  const result = await runQuery(CONVEX_FUNCTIONS.listNearby, {
    lat,
    lng,
    limit,
    cursor,
    dietary,
    radiusMeters: effectiveRadiusMeters,
  });

  if (!result || !Array.isArray(result.items)) {
    throw new Error("Restaurant data is unavailable right now.");
  }

  return result;
}

export async function refineRestaurantTags(restaurantIds = []) {
  requireConvexConfig();

  const ids = Array.from(new Set((restaurantIds || []).map(String).filter(looksLikeConvexId)));
  if (!ids.length) {
    return [];
  }

  const result = await runAction(CONVEX_FUNCTIONS.enrichRestaurantTags, {
    restaurantIds: ids,
  });

  return Array.isArray(result?.updated) ? result.updated : [];
}

export async function getRestaurantDetails({ id, originLat, originLng }) {
  requireConvexConfig();

  if (!looksLikeConvexId(id)) {
    return null;
  }

  return runQuery(CONVEX_FUNCTIONS.getRestaurantDetail, {
    id,
    originLat,
    originLng,
    sessionToken: getStoredSessionToken() || undefined,
  });
}

export async function searchGoogleLocation(query) {
  requireConvexConfig();
  return runAction(CONVEX_FUNCTIONS.geocodeSearch, { query });
}

export async function reverseGeocodeLocation(lat, lng) {
  requireConvexConfig();
  return runAction(CONVEX_FUNCTIONS.reverseGeocode, { lat, lng });
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

export async function setManagedRestaurantVisibility({ restaurantId, isHidden, reason }) {
  const sessionToken = getRequiredSessionToken();
  return runMutation(CONVEX_FUNCTIONS.setRestaurantVisibility, {
    sessionToken,
    restaurantId,
    isHidden,
    reason,
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

export async function setModerationUserBan({ userId, isBanned, reason }) {
  const sessionToken = getRequiredSessionToken();
  return runMutation(CONVEX_FUNCTIONS.setUserBan, {
    sessionToken,
    userId,
    isBanned,
    reason,
  });
}

export async function getSavedSearchState() {
  const sessionToken = getStoredSessionToken();
  if (!sessionToken || !hasConvexConfig()) {
    return null;
  }

  return runQuery(CONVEX_FUNCTIONS.getMySearchState, {
    sessionToken,
  });
}

export async function saveSearchState({
  lat,
  lng,
  label,
  shortLabel,
  radiusMeters,
  loadedCount,
  dietaryFilters = [],
}) {
  const sessionToken = getStoredSessionToken();
  if (!sessionToken || !hasConvexConfig()) {
    return { ok: false, skipped: true };
  }

  return runMutation(CONVEX_FUNCTIONS.saveMySearchState, {
    sessionToken,
    lat,
    lng,
    label,
    shortLabel,
    radiusMeters,
    loadedCount,
    dietaryFilters,
  });
}
