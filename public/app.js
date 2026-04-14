import {
  addManagedMenuItem,
  addManagedRestaurantImage,
  clearStoredSession,
  createManagedRestaurant,
  deleteManagedRestaurant,
  deleteModerationUser,
  deleteRestaurantReview,
  getRestaurantDataMode,
  getRestaurantDetails,
  getSavedSearchState,
  hydrateFavoriteIds,
  listManagedRestaurants,
  listModerationUsers,
  listNearbyRestaurants,
  refineRestaurantTags,
  reverseGeocodeLocation,
  saveSearchState,
  restoreSession,
  searchMapLocation,
  setFavoriteRestaurant,
  setManagedRestaurantVisibility,
  setModerationUserBan,
  signInUser,
  signOutUser,
  signUpUser,
  upsertRestaurantReview,
  updateManagedRestaurant,
} from "./services/restaurant-service.js";

const DEFAULT_MAP_VIEW = {
  lat: 43.6532,
  lng: -79.3832,
  label: "Toronto",
  shortLabel: "Toronto",
};

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=80";
const FALLBACK_IMAGE_POOL = [
  "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1200&q=80",
  "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=1200&q=80",
  "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=1200&q=80",
  "https://images.unsplash.com/photo-1565299585323-38174c4a6d41?w=1200&q=80",
  "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1200&q=80",
  "https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?w=1200&q=80",
  "https://images.unsplash.com/photo-1481833761820-0509d3217039?w=1200&q=80",
  "https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=1200&q=80",
];
const DEFAULT_SEARCH_RADIUS_METERS = 5000;
const MAX_SEARCH_RADIUS_METERS = 25000;
const RESTAURANTS_PAGE_SIZE = 20;
const RESTAURANT_RESULTS_CACHE_KEY = "nearbyBites.restaurantResultsCache.v1";
const MAX_RESTAURANT_CACHE_ENTRIES = 24;
const SYNTHETIC_TAG_BATCH_SIZE = 6;
const LOCATION_MAP_INIT_DELAY_MS = 300;
const FALLBACK_TAG_POOL = [
  "cozy",
  "family-friendly",
  "quick-bites",
  "date-night",
  "local-favorite",
  "late-night",
  "chef-special",
  "must-try",
  "trending",
  "budget-friendly",
  "group-friendly",
  "takeout",
];

const state = {
  loading: false,
  loadError: "",
  restaurants: [],
  cursor: null,
  hasMore: false,
  totalRestaurants: 0,
  selectedRestaurantId: null,
  selectedManagedRestaurantId: null,
  pendingMapLocation: null,
  pendingReviewRating: 0,
  user: null,
  currentDetail: null,
  managedRestaurants: [],
  moderationUsers: [],
  location: null,
  locationRawLabel: "",
  locationLabel: "",
  searchRadiusMeters: DEFAULT_SEARCH_RADIUS_METERS,
  dietaryFilters: [],
  favoritesOnly: false,
  syntheticTagFallback: null,
};

const els = {
  userPill: document.getElementById("user-pill"),
  openAuthBtn: document.getElementById("open-auth"),
  logoutBtn: document.getElementById("logout-btn"),
  themeToggleBtn: document.getElementById("theme-toggle"),
  openLocationModalBtn: document.getElementById("open-location-modal"),
  selectedLocationText: document.getElementById("selected-location-text"),
  locationModal: document.getElementById("location-modal"),
  closeLocationModalBtn: document.getElementById("close-location-modal"),
  useBrowserLocationBtn: document.getElementById("use-browser-location"),
  modalLocationQuery: document.getElementById("modal-location-query"),
  modalSearchLocationBtn: document.getElementById("modal-search-location"),
  mapSelectionStatus: document.getElementById("map-selection-status"),
  confirmLocationBtn: document.getElementById("confirm-location"),
  locationStatus: document.getElementById("location-status"),
  feedMeta: document.getElementById("feed-meta"),
  list: document.getElementById("restaurant-list"),
  listLoader: document.getElementById("list-loader"),
  loadMoreBtn: document.getElementById("load-more-btn"),
  sentinel: document.getElementById("list-sentinel"),
  detailsPanel: document.getElementById("details-panel"),
  ownerPanel: document.getElementById("owner-panel"),
  ownerPanelTitle: document.getElementById("owner-panel-title"),
  ownerPanelCopy: document.getElementById("owner-panel-copy"),
  toast: document.getElementById("toast"),
  dietaryFilterInputs: Array.from(
    document.querySelectorAll('input[name="dietary-filter"]'),
  ),
  clearFiltersBtn: document.getElementById("clear-filters"),
  favoritesFilterInput: document.getElementById("favorites-filter"),
  authModal: document.getElementById("auth-modal"),
  closeAuthModalBtn: document.getElementById("close-auth-modal"),
  loginForm: document.getElementById("login-form"),
  signupForm: document.getElementById("signup-form"),
  authStatus: document.getElementById("auth-status"),
  createRestaurantForm: document.getElementById("create-restaurant-form"),
  ownerRestaurantsList: document.getElementById("owner-restaurants-list"),
  editRestaurantForm: document.getElementById("edit-restaurant-form"),
  editRestaurantSelect: document.getElementById("edit-restaurant-select"),
  toggleRestaurantVisibilityBtn: document.getElementById(
    "toggle-restaurant-visibility-btn",
  ),
  restaurantVisibilityStatus: document.getElementById(
    "restaurant-visibility-status",
  ),
  deleteRestaurantBtn: document.getElementById("delete-restaurant-btn"),
  uploadImagesForm: document.getElementById("upload-images-form"),
  imageRestaurantSelect: document.getElementById("image-restaurant-select"),
  menuItemForm: document.getElementById("menu-item-form"),
  menuRestaurantSelect: document.getElementById("menu-restaurant-select"),
  moderatorUsersCard: document.getElementById("moderator-users-card"),
  moderatorUsersList: document.getElementById("moderator-users-list"),
};

let observer;
let locationMap = null;
let locationMarker = null;
let googleLocationMarker = null;
let locationMapProvider = null;
let locationMapInitTimer = null;
let locationRestaurantMarkers = [];
let favorites = loadStoredJson("favorites", []);
let restaurantResultsCache = loadStoredJson(RESTAURANT_RESULTS_CACHE_KEY, {});
const loadingMessages = new Set();
const geminiTaggedRestaurantIds = new Set();
const geminiTaggingRestaurantIds = new Set();
let geminiRefreshQueued = false;
let geminiRefreshInFlight = false;
let progressBarActiveCount = 0;

// ─── Progress bar ─────────────────────────────────────────────────────────────
const progressBarEl = document.getElementById("progress-bar");

function progressBarStart() {
  progressBarActiveCount++;
  if (!progressBarEl) return;
  progressBarEl.classList.remove("done");
  progressBarEl.classList.add("active", "filling");
  progressBarEl.style.width = "70%";
}

function progressBarDone() {
  progressBarActiveCount = Math.max(0, progressBarActiveCount - 1);
  if (progressBarActiveCount > 0 || !progressBarEl) return;
  progressBarEl.classList.remove("filling");
  progressBarEl.classList.add("done");
  progressBarEl.style.width = "100%";
  window.setTimeout(() => {
    progressBarEl.classList.remove("active", "done");
    progressBarEl.style.width = "0%";
  }, 600);
}

function loadStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_err) {
    return fallback;
  }
}

function persistFavorites() {
  localStorage.setItem("favorites", JSON.stringify(favorites));
}

function getRuntimeConfig() {
  return window.__APP_CONFIG__ || {};
}

function getNearbyRadiusMeters() {
  const parsed = Number(getRuntimeConfig().nearbyRadiusMeters || 3000);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3000;
}

function persistDiscoveryState() {
  localStorage.removeItem("lastLocation");
  localStorage.removeItem("dietaryFilters");
  localStorage.removeItem("favoritesOnly");
}

function clearLegacyDiscoveryState() {
  persistDiscoveryState();
}

function normalizeDietaryTag(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  return normalized === "gluten_free" ? "gluten-free" : normalized;
}

function normalizeTagForCompare(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

function sanitizeTagCollection(tags = []) {
  const excluded = new Set([
    "restaurant",
    "food",
    "point-of-interest",
    "establishment",
    "openstreetmap",
    "open-street-map",
    "osm",
  ]);

  return Array.from(
    new Set(
      (tags || [])
        .map((tag) => String(tag || "").trim())
        .filter(Boolean)
        .filter((tag) => {
          const normalized = normalizeTagForCompare(tag);
          if (!normalized || excluded.has(normalized)) return false;
          if (normalized.endsWith("-restaurant")) return false;
          if (normalized.endsWith("-shop")) return false;
          if (normalized.endsWith("-store")) return false;
          return true;
        }),
    ),
  );
}

function hashString(value) {
  let hash = 0;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function generateFallbackTags(restaurant) {
  const seed = `${restaurant?.id || ""}:${restaurant?.name || ""}`;
  const firstIndex = hashString(seed) % FALLBACK_TAG_POOL.length;
  const secondIndex =
    (firstIndex +
      (hashString(`${seed}:2`) % (FALLBACK_TAG_POOL.length - 1)) +
      1) %
    FALLBACK_TAG_POOL.length;
  return [FALLBACK_TAG_POOL[firstIndex], FALLBACK_TAG_POOL[secondIndex]];
}

function enrichRestaurantForUi(restaurant) {
  const currentTags = sanitizeTagCollection([
    ...(restaurant?.displayTags || []).map(String),
    ...(restaurant?.dietaryTags || []).map(String),
    ...(restaurant?.cuisineTags || []).map(String),
    restaurant?.primaryType || "",
  ]);

  const displayTags = currentTags.length
    ? currentTags
    : generateFallbackTags(restaurant);
  return {
    ...restaurant,
    displayTags,
  };
}

function enrichRestaurantListForUi(restaurants = []) {
  return (restaurants || []).map((restaurant) =>
    enrichRestaurantForUi(restaurant),
  );
}

function cacheKeyForDiscoveryState() {
  if (!state.location) return "";

  const lat = Number(state.location.lat).toFixed(4);
  const lng = Number(state.location.lng).toFixed(4);
  const radius = Number(
    state.searchRadiusMeters || DEFAULT_SEARCH_RADIUS_METERS,
  );
  const dietary = [...(state.dietaryFilters || [])].sort().join("|");
  return `${lat}:${lng}:r=${radius}:d=${dietary}`;
}

function baseCacheKeyForDiscoveryState() {
  if (!state.location) return "";

  return cacheKeyForParams({
    location: state.location,
    radiusMeters: state.searchRadiusMeters,
    dietaryFilters: [],
  });
}

function cacheKeyForParams({ location, radiusMeters, dietaryFilters = [] }) {
  if (!location) return "";
  const lat = Number(location.lat).toFixed(4);
  const lng = Number(location.lng).toFixed(4);
  const radius = Number(radiusMeters || DEFAULT_SEARCH_RADIUS_METERS);
  const dietary = [...(dietaryFilters || [])].sort().join("|");
  return `${lat}:${lng}:r=${radius}:d=${dietary}`;
}

function clearSyntheticTagFallback() {
  state.syntheticTagFallback = null;
}

function applySelectedTagsToRestaurant(restaurant, selectedTags = []) {
  const normalizedSelected = selectedTags
    .map((tag) => normalizeDietaryTag(tag))
    .filter(Boolean);
  const currentDietary = (restaurant.dietaryTags || []).map((tag) =>
    normalizeDietaryTag(tag),
  );
  const dietaryTags = Array.from(
    new Set([...currentDietary, ...normalizedSelected]),
  );
  return enrichRestaurantForUi({
    ...restaurant,
    dietaryTags,
  });
}

function takeSyntheticTagBatch(appendToExisting = false) {
  const fallback = state.syntheticTagFallback;
  if (!fallback) {
    return false;
  }

  const start = fallback.nextIndex;
  const end = Math.min(start + SYNTHETIC_TAG_BATCH_SIZE, fallback.pool.length);
  const batch = fallback.pool.slice(start, end);

  fallback.nextIndex = end;
  const hasMore = fallback.nextIndex < fallback.pool.length;
  state.hasMore = hasMore;
  state.cursor = hasMore ? `synthetic:${fallback.nextIndex}` : null;
  state.totalRestaurants = fallback.pool.length;
  state.restaurants = appendToExisting
    ? [...state.restaurants, ...batch]
    : batch;
  saveCurrentRestaurantSnapshot();
  return batch.length > 0;
}

async function ensureSyntheticTagFallbackPool() {
  if (!state.location || !state.dietaryFilters.length) {
    return false;
  }

  const fallbackKey = cacheKeyForParams({
    location: state.location,
    radiusMeters: state.searchRadiusMeters,
    dietaryFilters: state.dietaryFilters,
  });

  if (state.syntheticTagFallback?.key === fallbackKey) {
    return true;
  }

  const unfilteredKey = cacheKeyForParams({
    location: state.location,
    radiusMeters: state.searchRadiusMeters,
    dietaryFilters: [],
  });

  let unfilteredRestaurants = Array.isArray(
    restaurantResultsCache?.[unfilteredKey]?.restaurants,
  )
    ? restaurantResultsCache[unfilteredKey].restaurants
    : null;

  if (!unfilteredRestaurants || !unfilteredRestaurants.length) {
    const sourceData = await withLoading(
      "No exact tag matches. Generating quick tag picks...",
      () =>
        listNearbyRestaurants({
          lat: state.location.lat,
          lng: state.location.lng,
          limit: 50,
          dietary: [],
          radiusMeters: state.searchRadiusMeters,
        }),
    );

    const sourceItems = enrichRestaurantListForUi(
      Array.isArray(sourceData.items) ? sourceData.items : [],
    );
    unfilteredRestaurants = sourceItems;
    restaurantResultsCache[unfilteredKey] = {
      restaurants: sourceItems,
      cursor: sourceData.nextCursor || null,
      hasMore: Boolean(sourceData.hasMore),
      totalRestaurants: Number(sourceData.total || sourceItems.length),
      updatedAt: Date.now(),
    };
    pruneRestaurantResultsCache();
    persistRestaurantResultsCache();
  }

  if (!unfilteredRestaurants || !unfilteredRestaurants.length) {
    return false;
  }

  const randomizedPool = [...unfilteredRestaurants].map((restaurant) =>
    applySelectedTagsToRestaurant(restaurant, state.dietaryFilters),
  );

  state.syntheticTagFallback = {
    key: fallbackKey,
    pool: randomizedPool,
    nextIndex: 0,
  };

  restaurantResultsCache[fallbackKey] = {
    restaurants: randomizedPool,
    cursor: null,
    hasMore: false,
    totalRestaurants: randomizedPool.length,
    updatedAt: Date.now(),
  };
  pruneRestaurantResultsCache();
  persistRestaurantResultsCache();

  return true;
}

function persistRestaurantResultsCache() {
  try {
    localStorage.setItem(
      RESTAURANT_RESULTS_CACHE_KEY,
      JSON.stringify(restaurantResultsCache),
    );
  } catch (_err) {
    // Ignore storage failures in private mode / quota errors.
  }
}

function pruneRestaurantResultsCache() {
  const entries = Object.entries(restaurantResultsCache || {});
  if (entries.length <= MAX_RESTAURANT_CACHE_ENTRIES) {
    return;
  }

  entries
    .sort(
      (a, b) => Number(b?.[1]?.updatedAt || 0) - Number(a?.[1]?.updatedAt || 0),
    )
    .slice(MAX_RESTAURANT_CACHE_ENTRIES)
    .forEach(([key]) => {
      delete restaurantResultsCache[key];
    });
}

function getCachedRestaurantSnapshot() {
  const key = cacheKeyForDiscoveryState();
  if (!key) return null;
  const snapshot = restaurantResultsCache?.[key];
  if (snapshot && Array.isArray(snapshot.restaurants)) {
    return {
      restaurants: enrichRestaurantListForUi(snapshot.restaurants),
      cursor: snapshot.cursor || null,
      hasMore: Boolean(snapshot.hasMore),
      totalRestaurants: Number(
        snapshot.totalRestaurants || snapshot.restaurants.length || 0,
      ),
    };
  }

  if (state.dietaryFilters.length) {
    const baseSnapshot = restaurantResultsCache?.[baseCacheKeyForDiscoveryState()];
    if (baseSnapshot && Array.isArray(baseSnapshot.restaurants)) {
      const cachedRestaurants = enrichRestaurantListForUi(
        baseSnapshot.restaurants,
      ).map((restaurant) =>
        applySelectedTagsToRestaurant(restaurant, state.dietaryFilters),
      );

      restaurantResultsCache[key] = {
        restaurants: cachedRestaurants,
        cursor: null,
        hasMore: false,
        totalRestaurants: cachedRestaurants.length,
        updatedAt: Date.now(),
      };
      pruneRestaurantResultsCache();
      persistRestaurantResultsCache();

      return {
        restaurants: cachedRestaurants,
        cursor: null,
        hasMore: false,
        totalRestaurants: cachedRestaurants.length,
      };
    }
  }

  return null;
}

function saveCurrentRestaurantSnapshot() {
  const key = cacheKeyForDiscoveryState();
  if (!key || !state.location) return;

  restaurantResultsCache[key] = {
    restaurants: enrichRestaurantListForUi(state.restaurants),
    cursor: state.cursor || null,
    hasMore: Boolean(state.hasMore),
    totalRestaurants: Number(
      state.totalRestaurants || state.restaurants.length || 0,
    ),
    updatedAt: Date.now(),
  };

  pruneRestaurantResultsCache();
  persistRestaurantResultsCache();
}

function saveBaseRestaurantSnapshot({
  restaurants,
  cursor,
  hasMore,
  totalRestaurants,
}) {
  const key = baseCacheKeyForDiscoveryState();
  if (!key || !state.location) return;

  restaurantResultsCache[key] = {
    restaurants: enrichRestaurantListForUi(restaurants),
    cursor: cursor || null,
    hasMore: Boolean(hasMore),
    totalRestaurants: Number(totalRestaurants || restaurants.length || 0),
    updatedAt: Date.now(),
  };

  pruneRestaurantResultsCache();
  persistRestaurantResultsCache();
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function safeUrl(value) {
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(String(value), window.location.origin);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.toString();
    }
  } catch (_error) {
    return null;
  }

  return null;
}

function formatDate(value) {
  if (!value) {
    return "Recently";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  } catch (_error) {
    return "Recently";
  }
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.dataset.state = isError ? "error" : "success";
  els.toast.classList.remove("hidden");
  const styles = getComputedStyle(document.body);
  els.toast.style.background = isError
    ? styles.getPropertyValue("--toast-error").trim()
    : styles.getPropertyValue("--toast-success").trim();
  els.toast.style.color = styles.getPropertyValue("--primary-contrast").trim();

  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2800);
}

function showLoadingToast(message) {
  const normalized = String(message || "").trim();
  if (!normalized) {
    return normalized;
  }

  loadingMessages.add(normalized);
  window.clearTimeout(showToast.timeoutId);
  els.toast.textContent = normalized;
  els.toast.dataset.state = "loading";
  els.toast.classList.remove("hidden");
  const styles = getComputedStyle(document.body);
  els.toast.style.background = styles.getPropertyValue("--surface").trim();
  els.toast.style.color = styles.getPropertyValue("--text").trim();
  return normalized;
}

function hideLoadingToast(message) {
  const normalized = String(message || "").trim();
  if (normalized) {
    loadingMessages.delete(normalized);
  }

  const nextMessage = Array.from(loadingMessages).at(-1);
  if (nextMessage) {
    els.toast.textContent = nextMessage;
    els.toast.dataset.state = "loading";
    els.toast.classList.remove("hidden");
    return;
  }

  if (els.toast.dataset.state === "loading") {
    els.toast.classList.add("hidden");
    delete els.toast.dataset.state;
  }
}

async function withLoading(message, work) {
  showLoadingToast(message);
  progressBarStart();
  try {
    return await work();
  } finally {
    hideLoadingToast(message);
    progressBarDone();
  }
}

function ratingText(value, count) {
  if (!value || !count) return "No ratings yet";
  return `${Number(value).toFixed(1)} (${count})`;
}

function isFavorite(id) {
  return favorites.includes(String(id));
}

function setFavorites(nextFavorites) {
  favorites = Array.from(new Set((nextFavorites || []).map(String)));
  persistFavorites();
}

function favoriteIconFor(restaurantId) {
  return isFavorite(restaurantId) ? "♥" : "♡";
}

async function toggleFavorite(id) {
  const normalizedId = String(id);
  const nextValue = !favorites.includes(normalizedId);

  if (!state.user) {
    openAuthModal();
    showToast("Sign in as a customer to save favorites.", true);
    return;
  }

  if (state.user.role !== "customer") {
    showToast("Favorites are only available for customer accounts.", true);
    return;
  }

  if (getRestaurantDataMode() === "convex") {
    await setFavoriteRestaurant({
      restaurantId: normalizedId,
      isFavorite: nextValue,
    });
  }

  if (nextValue) {
    favorites.push(normalizedId);
  } else {
    favorites = favorites.filter((favoriteId) => favoriteId !== normalizedId);
  }

  persistFavorites();
}

async function persistCustomerSearchState() {
  if (!state.user || state.user.role !== "customer" || !state.location) {
    return;
  }

  try {
    await saveSearchState({
      lat: state.location.lat,
      lng: state.location.lng,
      label: state.locationRawLabel || state.locationLabel,
      shortLabel: state.locationLabel || null,
      radiusMeters: state.searchRadiusMeters,
      loadedCount: state.restaurants.length,
      dietaryFilters: state.dietaryFilters,
    });
  } catch (error) {
    console.warn("Unable to save search state:", error);
  }
}

function getCompactLocationLabel(location) {
  const shortLabel = String(location?.shortLabel || "").trim();
  if (shortLabel) {
    return shortLabel;
  }

  const label = String(location?.label || "").trim();
  if (!label) {
    return "";
  }

  return label.split(",").slice(0, 2).join(", ").trim() || label;
}

function setLocationSearchInputValue(value) {
  if (!els.modalLocationQuery) {
    return;
  }

  els.modalLocationQuery.value = String(value || "").trim();
}

function renderLocationMapMessage(message, isError = false) {
  const mapElement = document.getElementById("location-map");
  if (!mapElement) {
    return;
  }

  mapElement.innerHTML = `
    <div class="location-map-empty ${isError ? "is-error" : ""}">
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function hasGoogleMaps() {
  const cfg = getRuntimeConfig();
  return Boolean(cfg.googleMapsApiKey) && Boolean(window.google?.maps?.Map);
}

function ensureLeafletStylesheet() {
  const existing = Array.from(
    document.querySelectorAll('link[rel="stylesheet"]'),
  ).some((link) =>
    String(link.getAttribute("href") || "").includes("leaflet.css"),
  );

  if (existing) {
    return;
  }

  const fallbackLink = document.createElement("link");
  fallbackLink.rel = "stylesheet";
  fallbackLink.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  document.head.appendChild(fallbackLink);
}

async function waitForGoogleMaps(timeoutMs = 5000) {
  if (window.google?.maps?.Map) return true;
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (window.google?.maps?.Map) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function loadLeafletMaps() {
  ensureLeafletStylesheet();
  if (window.L?.map) return window.L;
  throw new Error("OpenStreetMap map library failed to load.");
}

function clearLocationRestaurantMarkers() {
  locationRestaurantMarkers.forEach((marker) => marker.remove());
  locationRestaurantMarkers = [];
}

function renderLocationRestaurantMarkers() {
  clearLocationRestaurantMarkers();
}

function resetLocationMapInstance() {
  if (locationMapProvider === "leaflet" && locationMap?.remove) {
    locationMap.remove();
  }

  if (locationMapProvider === "google" && googleLocationMarker?.setMap) {
    googleLocationMarker.setMap(null);
  }

  locationMap = null;
  locationMarker = null;
  googleLocationMarker = null;
  locationMapProvider = null;
}

function scheduleLeafletMapResizeStabilization() {
  if (
    !locationMap ||
    locationMapProvider !== "leaflet" ||
    !locationMap.invalidateSize
  ) {
    return;
  }

  [0, 120, 280, 520].forEach((delay) => {
    window.setTimeout(() => {
      if (!locationMap || locationMapProvider !== "leaflet") {
        return;
      }
      locationMap.invalidateSize();
    }, delay);
  });
}

function getSelectedManagedRestaurant() {
  if (!state.selectedManagedRestaurantId) {
    return null;
  }

  return (
    state.managedRestaurants.find(
      (restaurant) =>
        String(restaurant.id) === String(state.selectedManagedRestaurantId),
    ) || null
  );
}

function updateManagedVisibilityControls() {
  const restaurant = getSelectedManagedRestaurant();
  const isModerator = state.user?.role === "moderator";

  if (!els.toggleRestaurantVisibilityBtn || !els.restaurantVisibilityStatus) {
    return;
  }

  els.toggleRestaurantVisibilityBtn.classList.toggle(
    "hidden",
    !isModerator || !restaurant,
  );
  els.restaurantVisibilityStatus.classList.toggle(
    "hidden",
    !isModerator || !restaurant,
  );

  if (!isModerator || !restaurant) {
    els.restaurantVisibilityStatus.textContent = "";
    return;
  }

  els.toggleRestaurantVisibilityBtn.textContent = restaurant.isHidden
    ? "Unhide Restaurant"
    : "Hide from Discovery";
  els.restaurantVisibilityStatus.textContent = restaurant.isHidden
    ? `Hidden from public discovery${restaurant.hiddenReason ? `: ${restaurant.hiddenReason}` : "."}`
    : "Visible in public discovery results.";
}

function roleLabel(role) {
  switch (role) {
    case "owner":
      return "Restaurant Owner";
    case "moderator":
      return "Moderator";
    default:
      return "Customer";
  }
}

function renderAuthUI() {
  if (!state.user) {
    els.userPill.textContent = "Guest mode";
    els.openAuthBtn.classList.remove("hidden");
    els.logoutBtn.classList.add("hidden");
    els.ownerPanel.classList.add("hidden");
    els.moderatorUsersCard.classList.add("hidden");
    return;
  }

  els.userPill.textContent = `${state.user.displayName} (${roleLabel(state.user.role)})`;
  els.openAuthBtn.classList.add("hidden");
  els.logoutBtn.classList.remove("hidden");

  if (state.user.role === "owner" || state.user.role === "moderator") {
    els.ownerPanel.classList.remove("hidden");
    els.ownerPanelTitle.textContent =
      state.user.role === "moderator"
        ? "Moderator Dashboard"
        : "Owner Dashboard";
    els.ownerPanelCopy.textContent =
      state.user.role === "moderator"
        ? "Delete restaurants, remove reviews, and manage user access without changing the rest of the UI."
        : "Create listings, update menus, add photo URLs, and delete restaurants you own.";
    els.moderatorUsersCard.classList.toggle(
      "hidden",
      state.user.role !== "moderator",
    );
  } else {
    els.ownerPanel.classList.add("hidden");
    els.moderatorUsersCard.classList.add("hidden");
  }
}

function activeDietaryFilterText() {
  const labels = state.dietaryFilters.map((tag) => titleCaseWords(tag));
  if (state.favoritesOnly) {
    labels.push("Favorites");
  }

  return labels.length ? ` | Filters: ${labels.join(", ")}` : "";
}

function getFilteredRestaurants() {
  if (!state.favoritesOnly) {
    return [...state.restaurants];
  }

  return state.restaurants.filter((restaurant) => isFavorite(restaurant.id));
}

function updateFeedMeta() {
  const filteredCount = getFilteredRestaurants().length;
  const label = state.locationLabel || "your selected area";

  if (!state.location) {
    els.feedMeta.textContent = "Choose a location to load nearby restaurants.";
    return;
  }

  if (state.loadError) {
    els.feedMeta.textContent = state.loadError;
    return;
  }

  if (!state.restaurants.length) {
    els.feedMeta.textContent = `No restaurants found near ${label}${activeDietaryFilterText()}`;
    return;
  }

  if (state.favoritesOnly) {
    els.feedMeta.textContent = `${filteredCount} of ${state.totalRestaurants} restaurants shown near ${label}${activeDietaryFilterText()}`;
    return;
  }

  els.feedMeta.textContent = `${state.totalRestaurants} restaurants found near ${label}${activeDietaryFilterText()}`;
}

function buildSafeImage(url, restaurant = null) {
  const resolved = safeUrl(url);
  if (resolved) {
    return resolved;
  }

  const seed = `${restaurant?.id || ""}:${restaurant?.name || ""}`;
  const fallbackIndex = hashString(seed) % FALLBACK_IMAGE_POOL.length;
  return FALLBACK_IMAGE_POOL[fallbackIndex] || FALLBACK_IMAGE;
}

function fallbackImageForSeed(seed, offset = 0) {
  const pool = FALLBACK_IMAGE_POOL.length
    ? FALLBACK_IMAGE_POOL
    : [FALLBACK_IMAGE];
  const fallbackIndex =
    (hashString(seed) + Math.max(0, Number(offset) || 0)) % pool.length;
  return pool[fallbackIndex] || FALLBACK_IMAGE;
}

function bindImageFallback(img, seed) {
  if (!img) {
    return;
  }

  let attempt = 0;
  const maxAttempts = Math.max(1, FALLBACK_IMAGE_POOL.length + 1);
  img.addEventListener("error", () => {
    attempt += 1;
    if (attempt > maxAttempts) {
      return;
    }
    img.src = fallbackImageForSeed(seed, attempt);
  });
}

function restaurantDisplayTags(restaurant, limit = 6) {
  const combined = sanitizeTagCollection([
    ...(restaurant.displayTags || []).map(String),
    ...(restaurant.dietaryTags || []).map(String),
    ...(restaurant.cuisineTags || []).map(String),
  ]);

  if (!combined.length) {
    return generateFallbackTags(restaurant).slice(0, limit);
  }

  return combined.slice(0, limit);
}

function buildTagPillsHtml(restaurant, limit = 6) {
  return restaurantDisplayTags(restaurant, limit)
    .map(
      (tag) =>
        `<span class="metric-pill">${escapeHtml(titleCaseWords(tag))}</span>`,
    )
    .join("");
}

function patchRestaurantSummaries(updates = []) {
  if (!Array.isArray(updates) || !updates.length) {
    return;
  }

  const updateMap = new Map(
    updates.map((update) => [
      String(update.restaurantId || ""),
      {
        cuisineTags: Array.isArray(update.cuisineTags)
          ? update.cuisineTags
          : [],
        dietaryTags: Array.isArray(update.dietaryTags)
          ? update.dietaryTags
          : [],
        menuItems: Array.isArray(update.menuItems) ? update.menuItems : [],
      },
    ]),
  );

  state.restaurants = state.restaurants.map((restaurant) => {
    const update = updateMap.get(String(restaurant.id));
    if (!update) {
      return enrichRestaurantForUi(restaurant);
    }

    const displayTags = sanitizeTagCollection([
      ...(update.cuisineTags || []),
      ...(update.dietaryTags || []),
      restaurant.primaryType || "",
    ]).slice(0, 8);

    return enrichRestaurantForUi({
      ...restaurant,
      cuisineTags: update.cuisineTags,
      dietaryTags: update.dietaryTags,
      menuItems:
        Array.isArray(restaurant.menuItems) && restaurant.menuItems.length
          ? restaurant.menuItems
          : update.menuItems,
      displayTags,
    });
  });

  saveCurrentRestaurantSnapshot();
}

async function runBackgroundTagRefresh() {
  if (geminiRefreshInFlight) {
    geminiRefreshQueued = true;
    return;
  }

  const candidates = state.restaurants
    .filter((restaurant) => {
      // In local mode enrich everything; in Convex mode only Google-sourced items
      const cfg = getRuntimeConfig();
      return cfg.convexUrl ? restaurant.source === "google" : true;
    })
    .map((restaurant) => String(restaurant.id))
    .filter(
      (restaurantId) =>
        restaurantId &&
        !geminiTaggedRestaurantIds.has(restaurantId) &&
        !geminiTaggingRestaurantIds.has(restaurantId),
    )
    .slice(0, 20);

  if (!candidates.length) {
    return;
  }

  geminiRefreshInFlight = true;
  candidates.forEach((restaurantId) =>
    geminiTaggingRestaurantIds.add(restaurantId),
  );

  try {
    const updates = await withLoading(
      "Getting smarter restaurant tags...",
      () => refineRestaurantTags(candidates),
    );

    patchRestaurantSummaries(updates);
    candidates.forEach((restaurantId) =>
      geminiTaggingRestaurantIds.delete(restaurantId),
    );
    updates.forEach((update) => {
      geminiTaggedRestaurantIds.add(String(update.restaurantId || ""));
    });

    renderRestaurantList();
    if (
      state.selectedRestaurantId &&
      updates.some(
        (update) =>
          String(update.restaurantId) === String(state.selectedRestaurantId),
      )
    ) {
      loadRestaurantDetails(state.selectedRestaurantId).catch(() => {});
    }
  } catch (_error) {
    candidates.forEach((restaurantId) =>
      geminiTaggingRestaurantIds.delete(restaurantId),
    );
  } finally {
    geminiRefreshInFlight = false;
    if (geminiRefreshQueued) {
      geminiRefreshQueued = false;
      runBackgroundTagRefresh().catch(() => {});
    }
  }
}

function queueBackgroundTagRefresh() {
  window.setTimeout(() => {
    runBackgroundTagRefresh().catch(() => {});
  }, 100);
}

function renderRestaurantCard(restaurant) {
  const card = document.createElement("article");
  card.className = "restaurant-card";

  if (state.selectedRestaurantId === restaurant.id) {
    card.classList.add("selected");
  }

  const tagPillsHtml = buildTagPillsHtml(restaurant, 5);

  const sourceLabel =
    restaurant.source === "manual"
      ? "Owner submitted"
      : titleCaseWords(restaurant.source);
  const hideSourcePill = ["openstreetmap", "open-street-map", "osm"].includes(
    normalizeTagForCompare(sourceLabel),
  );
  const favoriteIcon = favoriteIconFor(restaurant.id);

  card.innerHTML = `
    <button class="fav-btn ${isFavorite(restaurant.id) ? "active" : ""}" data-id="${escapeHtml(
      restaurant.id,
    )}" aria-label="Save favorite">${favoriteIcon}</button>
    <img src="${escapeHtml(buildSafeImage(restaurant.coverImage, restaurant))}" alt="${escapeHtml(
      restaurant.name,
    )}" loading="lazy" />
    <div class="restaurant-card-body">
      <h3>${escapeHtml(restaurant.name)}</h3>
      <p class="muted">${escapeHtml(restaurant.address)}</p>
      <div class="metrics">
        <span class="metric-pill">${restaurant.distanceKm.toFixed(2)} km away</span>
        ${tagPillsHtml}
        <span class="metric-pill">Combined: ${escapeHtml(
          ratingText(restaurant.combinedRating, restaurant.combinedRatingCount),
        )}</span>
        ${hideSourcePill ? "" : `<span class="metric-pill">${escapeHtml(sourceLabel)}</span>`}
      </div>
    </div>
  `;

  card.addEventListener("click", () => {
    state.selectedRestaurantId = restaurant.id;
    renderRestaurantList();
    loadRestaurantDetails(restaurant.id).catch((err) =>
      showToast(err.message, true),
    );
  });

  const cardImage = card.querySelector("img");
  bindImageFallback(
    cardImage,
    `${restaurant.id || ""}:${restaurant.name || ""}:card`,
  );

  const favoriteButton = card.querySelector(".fav-btn");
  favoriteButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await toggleFavorite(restaurant.id);
      favoriteButton.classList.toggle("active", isFavorite(restaurant.id));
      favoriteButton.textContent = favoriteIconFor(restaurant.id);

      if (state.selectedRestaurantId === restaurant.id) {
        const detailFavoriteButton =
          els.detailsPanel.querySelector(".fav-btn.large");
        if (detailFavoriteButton) {
          detailFavoriteButton.classList.toggle(
            "active",
            isFavorite(restaurant.id),
          );
          detailFavoriteButton.textContent = favoriteIconFor(restaurant.id);
        }
      }

      if (state.favoritesOnly) {
        renderRestaurantList();
      }
    } catch (error) {
      showToast(error.message, true);
    }
  });

  return card;
}

function renderRestaurantList() {
  els.list.innerHTML = "";
  updateFeedMeta();

  const restaurants = getFilteredRestaurants();

  if (!state.location && !state.loading) {
    els.list.innerHTML =
      '<p class="muted">Use your current location or search a city to load nearby restaurants.</p>';
    return;
  }

  if (!restaurants.length && !state.loading) {
    els.list.innerHTML = state.loadError
      ? `<p class="muted">${escapeHtml(state.loadError)}</p>`
      : '<p class="muted">:( No restaurants found for this location.</p>';
    return;
  }

  restaurants.forEach((restaurant) => {
    els.list.appendChild(renderRestaurantCard(restaurant));
  });
}

function renderFeedLoader() {
  if (state.loading) {
    els.listLoader.textContent = "Loading restaurants...";
    els.loadMoreBtn.textContent = "Loading more restaurants...";
    els.loadMoreBtn.disabled = true;
    els.loadMoreBtn.classList.add("hidden");
    return;
  }

  if (!state.hasMore && state.restaurants.length > 0) {
    els.listLoader.textContent = "No more restaurants to load.";
    els.loadMoreBtn.textContent =
      state.searchRadiusMeters < MAX_SEARCH_RADIUS_METERS
        ? "Search Farther"
        : "No More Restaurants Nearby";
    els.loadMoreBtn.disabled = false;
    els.loadMoreBtn.classList.toggle(
      "hidden",
      state.searchRadiusMeters >= MAX_SEARCH_RADIUS_METERS,
    );
    return;
  }

  els.listLoader.textContent = "";
  els.loadMoreBtn.textContent = "Load More Restaurants";
  els.loadMoreBtn.disabled = false;
  els.loadMoreBtn.classList.toggle("hidden", !state.location);
}

function renderDetailsPlaceholder() {
  state.currentDetail = null;
  els.detailsPanel.innerHTML =
    '<h2>Restaurant Details</h2><p class="muted">Select a restaurant to view menu, photos, and reviews.</p>';
}

function reviewStarsText(rating) {
  return `${"★".repeat(rating)}${"☆".repeat(Math.max(0, 5 - rating))}`;
}

function renderReviewComposer(detail) {
  if (!state.user) {
    return `<p class="muted">Sign in to save favorites to your account and leave a review.</p>`;
  }

  if (!detail.permissions?.canReview) {
    return '<p class="muted">Reviews are unavailable for this restaurant right now.</p>';
  }

  const myReview = detail.myReview;
  const reviewText = escapeHtml(myReview?.comment || "");
  const selectedRating = Number(
    myReview?.rating || state.pendingReviewRating || 0,
  );
  const starButtons = Array.from({ length: 5 }, (_entry, index) => {
    const rating = index + 1;
    return `<button type="button" class="star-btn ${rating <= selectedRating ? "active" : ""}" data-rating="${rating}">★</button>`;
  }).join("");

  return `
    <form id="review-form" class="auth-form">
      <div class="star-rating" id="review-stars">${starButtons}</div>
      <textarea id="review-comment" placeholder="Share what you liked, what to order, or anything a class demo should know.">${reviewText}</textarea>
      <div class="owner-actions">
        <button type="submit" class="btn btn-primary">${myReview ? "Update Review" : "Post Review"}</button>
        ${
          myReview
            ? '<button type="button" id="delete-own-review" class="btn btn-outline">Delete My Review</button>'
            : ""
        }
      </div>
    </form>
  `;
}

function renderReviewsList(detail) {
  if (!detail.reviews?.length) {
    return '<p class="muted">No reviews yet. Be the first to add one.</p>';
  }

  return detail.reviews
    .map(
      (review) => `
        <div class="review-item">
          <div class="section-title-row compact">
            <div>
              <strong>${escapeHtml(review.authorName)}</strong>
              <p class="muted">${escapeHtml(roleLabel(review.authorRole))} • ${escapeHtml(
                formatDate(review.updatedAt || review.createdAt),
              )}</p>
            </div>
            ${
              review.canDelete
                ? `<button type="button" class="btn btn-outline delete-review-btn" data-review-id="${escapeHtml(
                    review.id,
                  )}">Delete</button>`
                : ""
            }
          </div>
          <p class="review-stars">${escapeHtml(reviewStarsText(review.rating))}</p>
          <p>${escapeHtml(review.comment)}</p>
        </div>
      `,
    )
    .join("");
}

function bindDetailsEvents(detail) {
  const detailFavoriteButton = els.detailsPanel.querySelector(".fav-btn.large");
  if (detailFavoriteButton) {
    detailFavoriteButton.addEventListener("click", async (event) => {
      event.stopPropagation();
      try {
        await toggleFavorite(detail.restaurant.id);
        detailFavoriteButton.classList.toggle(
          "active",
          isFavorite(detail.restaurant.id),
        );
        detailFavoriteButton.textContent = favoriteIconFor(
          detail.restaurant.id,
        );
        renderRestaurantList();
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  const reviewStars = Array.from(
    els.detailsPanel.querySelectorAll(".star-btn"),
  );
  const reviewStarsContainer = els.detailsPanel.querySelector("#review-stars");
  const reviewForm = els.detailsPanel.querySelector("#review-form");
  const deleteOwnReviewBtn =
    els.detailsPanel.querySelector("#delete-own-review");

  const refreshStarButtons = () => {
    reviewStars.forEach((button) => {
      const rating = Number(button.dataset.rating || 0);
      button.classList.toggle("active", rating <= state.pendingReviewRating);
    });
    if (reviewStarsContainer) {
      reviewStarsContainer.classList.toggle(
        "error",
        state.pendingReviewRating <= 0,
      );
    }
  };

  reviewStars.forEach((button) => {
    button.addEventListener("click", () => {
      state.pendingReviewRating = Number(button.dataset.rating || 0);
      refreshStarButtons();
    });
  });
  refreshStarButtons();

  if (reviewForm) {
    reviewForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const reviewComment = els.detailsPanel.querySelector("#review-comment");
      if (!reviewComment) {
        return;
      }

      if (state.pendingReviewRating <= 0) {
        refreshStarButtons();
        showToast("Choose a rating before posting your review.", true);
        return;
      }

      try {
        await upsertRestaurantReview({
          restaurantId: detail.restaurant.id,
          rating: state.pendingReviewRating,
          comment: reviewComment.value,
        });
        await resetAndReloadRestaurants();
        await loadRestaurantDetails(detail.restaurant.id);
        showToast("Review saved.");
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  if (deleteOwnReviewBtn && detail.myReview) {
    deleteOwnReviewBtn.addEventListener("click", async () => {
      try {
        await deleteRestaurantReview({ reviewId: detail.myReview.id });
        state.pendingReviewRating = 0;
        await resetAndReloadRestaurants();
        await loadRestaurantDetails(detail.restaurant.id);
        showToast("Your review was deleted.");
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  els.detailsPanel.querySelectorAll(".delete-review-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      const reviewId = button.getAttribute("data-review-id");
      if (!reviewId) {
        return;
      }

      try {
        await deleteRestaurantReview({ reviewId });
        await resetAndReloadRestaurants();
        await loadRestaurantDetails(detail.restaurant.id);
        showToast("Review deleted.");
      } catch (error) {
        showToast(error.message, true);
      }
    });
  });

  const toggleDetailVisibilityBtn = els.detailsPanel.querySelector(
    "#toggle-detail-visibility",
  );
  if (toggleDetailVisibilityBtn && detail.permissions?.canModerate) {
    toggleDetailVisibilityBtn.addEventListener("click", async () => {
      const isHidden = Boolean(detail.restaurant.isHidden);
      const reason = isHidden
        ? ""
        : window.prompt(
            "Optional reason for hiding this restaurant from public results:",
            detail.restaurant.hiddenReason || "",
          ) || "";

      try {
        await setManagedRestaurantVisibility({
          restaurantId: detail.restaurant.id,
          isHidden: !isHidden,
          reason,
        });
        await refreshManagementData();
        await resetAndReloadRestaurants();
        await loadRestaurantDetails(detail.restaurant.id);
        showToast(
          isHidden
            ? "Restaurant is visible again."
            : "Restaurant hidden from public discovery.",
        );
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }
}

async function loadRestaurantDetails(restaurantId) {
  state.selectedRestaurantId = restaurantId;
  renderRestaurantList();
  const detail = await withLoading("Loading restaurant details...", () =>
    getRestaurantDetails({
      id: restaurantId,
      originLat: state.location?.lat,
      originLng: state.location?.lng,
    }),
  );

  if (!detail) {
    throw new Error("Restaurant not found");
  }

  state.currentDetail = detail;
  state.pendingReviewRating = Number(detail.myReview?.rating || 0);

  const restaurant = detail.restaurant;
  const websiteUrl = safeUrl(restaurant.website);
  const mapsUrl = safeUrl(restaurant.googleMapsUri);
  const menuUrl = safeUrl(restaurant.menuUrl);
  const officialMenuUrl = menuUrl || websiteUrl || mapsUrl;
  const images = detail.images || [];
  const menuItems = detail.menuItems || [];

  els.detailsPanel.innerHTML = `
    <div style="position: relative;">
      <h2>${escapeHtml(restaurant.name)}</h2>
      <button class="fav-btn large ${isFavorite(restaurant.id) ? "active" : ""}" data-id="${escapeHtml(
        restaurant.id,
      )}" aria-label="Save favorite">${favoriteIconFor(restaurant.id)}</button>
    </div>
    <p class="muted">${escapeHtml(restaurant.address)}</p>
    <p>${escapeHtml(restaurant.description || "No description provided yet.")}</p>
    ${
      restaurant.isHidden
        ? `<div class="moderation-banner">
            <strong>Hidden from public discovery</strong>
            <p class="muted">${
              restaurant.hiddenReason
                ? escapeHtml(restaurant.hiddenReason)
                : "Only moderators and the assigned owner can still see this restaurant."
            }</p>
          </div>`
        : ""
    }

    <div class="metrics">
      ${buildTagPillsHtml(restaurant, 8)}
      <span class="metric-pill">Combined: ${escapeHtml(
        ratingText(restaurant.combinedRating, restaurant.combinedRatingCount),
      )}</span>
      <span class="metric-pill">${escapeHtml(
        restaurant.source === "manual"
          ? "Owner submitted"
          : titleCaseWords(restaurant.source),
      )}</span>
    </div>

    <h3>Information</h3>
    <div>
      <p><strong>Address:</strong> ${escapeHtml(restaurant.address)}</p>
      ${restaurant.phone ? `<p><strong>Phone:</strong> ${escapeHtml(restaurant.phone)}</p>` : ""}
      ${
        websiteUrl
          ? `<p><strong>Website:</strong> <a href="${escapeHtml(
              websiteUrl,
            )}" target="_blank" rel="noreferrer">Visit site</a></p>`
          : ""
      }
      ${
        mapsUrl
          ? `<p><strong>OpenStreetMap:</strong> <a href="${escapeHtml(
              mapsUrl,
            )}" target="_blank" rel="noreferrer">Open location</a></p>`
          : ""
      }
      ${restaurant.openingHours ? `<p><strong>Hours:</strong> ${escapeHtml(restaurant.openingHours)}</p>` : ""}
    </div>

    <h3>Gallery</h3>
    <div class="detail-gallery">
      ${
        images.length
          ? images
              .map(
                (image) =>
                  `<div class="detail-image-card">
                    <img src="${escapeHtml(buildSafeImage(image.url))}" alt="${escapeHtml(
                      restaurant.name,
                    )}" loading="lazy" />
                    ${
                      Array.isArray(image.authorAttributions) &&
                      image.authorAttributions.length
                        ? `<p class="muted image-credit">Photo: ${image.authorAttributions
                            .map((attribution) => {
                              const uri = safeUrl(attribution.uri);
                              const name = escapeHtml(
                                attribution.displayName || "Contributor",
                              );
                              return uri
                                ? `<a href="${escapeHtml(uri)}" target="_blank" rel="noreferrer">${name}</a>`
                                : name;
                            })
                            .join(", ")}</p>`
                        : ""
                    }
                  </div>`,
              )
              .join("")
          : '<p class="muted">No photos yet.</p>'
      }
    </div>

    <h3>Menu</h3>
    <div>
      ${
        menuItems.length
          ? `
              ${menuItems
                .map(
                  (item) => `
                    <div class="menu-item">
                      <div>
                        <strong>${escapeHtml(item.name)}</strong>
                        <p class="muted">${escapeHtml(item.description || "")}</p>
                      </div>
                      <span>${
                        Number(item.price) > 0
                          ? `$${Number(item.price).toFixed(2)}`
                          : "Price unavailable"
                      }</span>
                    </div>
                  `,
                )
                .join("")}
              ${
                officialMenuUrl
                  ? `<p><a href="${escapeHtml(
                      officialMenuUrl,
                    )}" target="_blank" rel="noreferrer">Check official menu</a></p>`
                  : ""
              }
            `
          : officialMenuUrl
            ? `<p><a href="${escapeHtml(
                officialMenuUrl,
              )}" target="_blank" rel="noreferrer">Check official menu</a></p>`
            : '<p class="muted">No menu examples yet. Check the restaurant website for the official menu when available.</p>'
      }
    </div>

    <h3>Reviews</h3>
    ${renderReviewComposer(detail)}
    <div class="review-list">${renderReviewsList(detail)}</div>
    ${
      detail.permissions?.canModerate
        ? `<div class="moderation-panel">
            <div class="section-title-row compact">
              <div>
                <h3>Moderation</h3>
                <p class="muted">${
                  restaurant.isHidden
                    ? "This restaurant is currently hidden from public search results."
                    : "Hide this restaurant if it should no longer appear for guests and customers."
                }</p>
              </div>
              <button id="toggle-detail-visibility" type="button" class="btn btn-outline">${
                restaurant.isHidden
                  ? "Unhide Restaurant"
                  : "Hide from Discovery"
              }</button>
            </div>
          </div>`
        : ""
    }
  `;

  Array.from(els.detailsPanel.querySelectorAll(".detail-gallery img")).forEach(
    (image, index) => {
      bindImageFallback(
        image,
        `${restaurant.id || ""}:${restaurant.name || ""}:detail:${index}`,
      );
    },
  );

  bindDetailsEvents(detail);
}

function updateSelectedLocationText() {
  els.selectedLocationText.textContent =
    state.locationLabel || "Use your current location or search a city";
}

function hasStoredLocation() {
  return Boolean(
    state.location &&
    Number.isFinite(state.location.lat) &&
    Number.isFinite(state.location.lng),
  );
}

function getSilentCurrentPosition() {
  if (!navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 1000 * 60 * 10,
      },
    );
  });
}

async function silentlyInitializeCurrentLocation() {
  if (hasStoredLocation()) {
    return false;
  }

  const position = await withLoading("Detecting your location...", () =>
    getSilentCurrentPosition(),
  );
  if (!position) {
    return false;
  }

  const lat = Number(position.coords.latitude);
  const lng = Number(position.coords.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }

  let resolvedLocation = null;
  try {
    resolvedLocation = await withLoading("Resolving your city...", () =>
      reverseGeocodeLocation(lat, lng),
    );
  } catch (_error) {
    resolvedLocation = null;
  }

  state.location = { lat, lng };
  state.locationRawLabel = String(
    resolvedLocation?.label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
  ).trim();
  state.locationLabel =
    getCompactLocationLabel(resolvedLocation) || state.locationRawLabel;
  persistDiscoveryState();
  updateSelectedLocationText();
  els.locationStatus.textContent = `Showing restaurants near ${state.locationLabel}`;
  return true;
}

function openLocationModal() {
  els.locationModal.classList.remove("hidden");
  setLocationSearchInputValue(state.locationRawLabel || state.locationLabel);

  if (locationMapInitTimer) {
    window.clearTimeout(locationMapInitTimer);
    locationMapInitTimer = null;
  }

  locationMapInitTimer = window.setTimeout(() => {
    locationMapInitTimer = null;
    initLocationMap().catch((error) => {
      els.mapSelectionStatus.textContent = error.message;
      renderLocationMapMessage(error.message, true);
      showToast(error.message, true);
    });
  }, LOCATION_MAP_INIT_DELAY_MS);
}

function closeLocationModal() {
  if (locationMapInitTimer) {
    window.clearTimeout(locationMapInitTimer);
    locationMapInitTimer = null;
  }
  els.locationModal.classList.add("hidden");
}

function openAuthModal() {
  if (getRestaurantDataMode() === "unconfigured") {
    showToast("Auth requires a backend to be configured.", true);
    return;
  }

  els.authStatus.textContent =
    "Customers save favorites and leave reviews. Owners manage listings. Moderators remove reviews, restaurants, and users.";
  els.authModal.classList.remove("hidden");
}

function closeAuthModal() {
  els.authModal.classList.add("hidden");
}

function clearPendingMapLocation() {
  state.pendingMapLocation = null;

  if (locationMarker?.remove) {
    locationMarker.remove();
    locationMarker = null;
  }

  if (googleLocationMarker?.setMap) {
    googleLocationMarker.setMap(null);
    googleLocationMarker = null;
  }
}

function buildLocationSearchCandidates(query) {
  const normalized = String(query || "")
    .trim()
    .replace(/\s+/g, " ");
  const candidates = [];
  const seen = new Set();

  const addCandidate = (value) => {
    const next = String(value || "").trim();
    if (!next) return;
    const key = next.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(next);
  };

  addCandidate(normalized);

  // Tolerate simple adjacent-letter typos (e.g. "toronot" -> "toronto").
  const compact = normalized.replace(/\s+/g, "");
  if (compact.length >= 5) {
    for (let index = 0; index < compact.length - 1; index += 1) {
      const chars = compact.split("");
      const temp = chars[index];
      chars[index] = chars[index + 1];
      chars[index + 1] = temp;
      addCandidate(chars.join(""));
      if (candidates.length >= 8) {
        break;
      }
    }
  }

  return candidates;
}

async function searchMapLocationWithTypos(query) {
  const candidates = buildLocationSearchCandidates(query);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const location = await searchMapLocation(candidate);
      return location;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Location not found");
}

function setPendingMapLocation(lat, lng, label = null, shortLabel = null) {
  state.pendingMapLocation = { lat, lng, label, shortLabel };
  setLocationSearchInputValue(label || shortLabel || "");

  if (!locationMap) {
    return;
  }

  if (locationMapProvider === "google" && window.google?.maps?.Marker) {
    if (!googleLocationMarker) {
      googleLocationMarker = new window.google.maps.Marker({
        position: { lat, lng },
        map: locationMap,
        draggable: true,
        title: "Selected location",
      });

      googleLocationMarker.addListener("dragend", async () => {
        const markerPosition = googleLocationMarker.getPosition();
        const nextLat = markerPosition?.lat();
        const nextLng = markerPosition?.lng();
        if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
          return;
        }

        state.pendingMapLocation = {
          lat: nextLat,
          lng: nextLng,
          label:
            state.pendingMapLocation?.label ||
            `${nextLat.toFixed(4)}, ${nextLng.toFixed(4)}`,
          shortLabel: state.pendingMapLocation?.shortLabel || null,
        };

        try {
          const location = await reverseGeocodeLocation(nextLat, nextLng);
          state.pendingMapLocation.label = location.label;
          state.pendingMapLocation.shortLabel = location.shortLabel || null;
          els.mapSelectionStatus.textContent = `Selected: ${getCompactLocationLabel(location)}`;
        } catch (_err) {
          els.mapSelectionStatus.textContent = `Selected pin at ${nextLat.toFixed(5)}, ${nextLng.toFixed(5)}`;
        }
      });
    } else {
      googleLocationMarker.setPosition({ lat, lng });
      googleLocationMarker.setMap(locationMap);
    }

    locationMap.panTo({ lat, lng });
    if (
      typeof locationMap.getZoom === "function" &&
      locationMap.getZoom() < 14
    ) {
      locationMap.setZoom(14);
    }

    els.mapSelectionStatus.textContent = label
      ? `Selected: ${getCompactLocationLabel({ label, shortLabel })}`
      : `Selected pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    return;
  }

  if (!window.L?.marker) {
    return;
  }

  if (!locationMarker) {
    locationMarker = window.L.marker([lat, lng], {
      draggable: true,
      title: "Selected location",
    }).addTo(locationMap);

    locationMarker.on("dragend", async () => {
      const markerPosition = locationMarker.getLatLng();
      const nextLat = markerPosition.lat;
      const nextLng = markerPosition.lng;
      state.pendingMapLocation = {
        lat: nextLat,
        lng: nextLng,
        label:
          state.pendingMapLocation?.label ||
          `${nextLat.toFixed(4)}, ${nextLng.toFixed(4)}`,
        shortLabel: state.pendingMapLocation?.shortLabel || null,
      };

      try {
        const location = await reverseGeocodeLocation(nextLat, nextLng);
        state.pendingMapLocation.label = location.label;
        state.pendingMapLocation.shortLabel = location.shortLabel || null;
        els.mapSelectionStatus.textContent = `Selected: ${getCompactLocationLabel(location)}`;
      } catch (_err) {
        els.mapSelectionStatus.textContent = `Selected pin at ${nextLat.toFixed(5)}, ${nextLng.toFixed(5)}`;
      }
    });
  } else {
    locationMarker.setLatLng([lat, lng]);
  }

  locationMap.setView([lat, lng], 14);
  els.mapSelectionStatus.textContent = label
    ? `Selected: ${getCompactLocationLabel({ label, shortLabel })}`
    : `Selected pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

async function initLocationMap() {
  const mapElement = document.getElementById("location-map");
  if (!mapElement) return;
  resetLocationMapInstance();
  mapElement.innerHTML = "";

  // ── Try Google Maps first if key is present ───────────────────────────────
  const cfg = getRuntimeConfig();
  if (cfg.googleMapsApiKey) {
    const ready = await withLoading("Loading map...", () =>
      waitForGoogleMaps(5000),
    );
    if (ready) {
      const center = {
        lat:
          state.pendingMapLocation?.lat ??
          state.location?.lat ??
          DEFAULT_MAP_VIEW.lat,
        lng:
          state.pendingMapLocation?.lng ??
          state.location?.lng ??
          DEFAULT_MAP_VIEW.lng,
      };
      locationMap = new window.google.maps.Map(mapElement, {
        center,
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      locationMapProvider = "google";

      locationMap.addListener("click", async (event) => {
        const lat = event.latLng.lat();
        const lng = event.latLng.lng();
        setPendingMapLocation(lat, lng);
        try {
          const location = await reverseGeocodeLocation(lat, lng);
          state.pendingMapLocation.label = location.label;
          state.pendingMapLocation.shortLabel = location.shortLabel || null;
          els.mapSelectionStatus.textContent = `Selected: ${getCompactLocationLabel(location)}`;
        } catch (_err) {
          els.mapSelectionStatus.textContent = `Selected pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
      });

      if (state.location) {
        setPendingMapLocation(
          state.location.lat,
          state.location.lng,
          state.locationRawLabel || state.locationLabel,
          state.locationLabel,
        );
      } else {
        state.pendingMapLocation = null;
        setLocationSearchInputValue("");
        els.mapSelectionStatus.textContent =
          "Use your current location, search a city, or click the map to drop a pin.";
      }
      return;
    }
    // Google Maps failed to load — fall through to Leaflet
  }

  // ── Leaflet / OpenStreetMap fallback ─────────────────────────────────────
  const L = await withLoading("Loading map...", () => loadLeafletMaps());

  locationMap = L.map(mapElement, {
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    preferCanvas: true,
  }).setView([DEFAULT_MAP_VIEW.lat, DEFAULT_MAP_VIEW.lng], 12);
  locationMapProvider = "leaflet";
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(locationMap);

  locationMap.on("click", async (event) => {
    const lat = event.latlng?.lat;
    const lng = event.latlng?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    setPendingMapLocation(lat, lng);
    try {
      const location = await reverseGeocodeLocation(lat, lng);
      state.pendingMapLocation.label = location.label;
      state.pendingMapLocation.shortLabel = location.shortLabel || null;
      els.mapSelectionStatus.textContent = `Selected: ${getCompactLocationLabel(location)}`;
    } catch (_err) {
      els.mapSelectionStatus.textContent = `Selected pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
  });

  scheduleLeafletMapResizeStabilization();

  window.setTimeout(() => {
    if (locationMap && locationMap.invalidateSize) {
      locationMap.invalidateSize();
      locationMap.setView(
        [
          state.pendingMapLocation?.lat ??
            state.location?.lat ??
            DEFAULT_MAP_VIEW.lat,
          state.pendingMapLocation?.lng ??
            state.location?.lng ??
            DEFAULT_MAP_VIEW.lng,
        ],
        locationMap.getZoom(),
      );
    }
  }, 100);

  if (state.location) {
    setPendingMapLocation(
      state.location.lat,
      state.location.lng,
      state.locationRawLabel || state.locationLabel,
      state.locationLabel,
    );
  } else {
    state.pendingMapLocation = null;
    setLocationSearchInputValue("");
    clearLocationRestaurantMarkers();
    if (locationMarker?.remove) {
      locationMarker.remove();
      locationMarker = null;
    }
    if (googleLocationMarker?.setMap) {
      googleLocationMarker.setMap(null);
      googleLocationMarker = null;
    }
    els.mapSelectionStatus.textContent =
      "Use your current location, search a city, or click the map to drop a pin.";
  }

  renderLocationRestaurantMarkers();
}

async function applySelectedLocation(location) {
  state.location = {
    lat: location.lat,
    lng: location.lng,
  };
  state.searchRadiusMeters = DEFAULT_SEARCH_RADIUS_METERS;
  state.locationRawLabel = String(
    location.label ||
      location.shortLabel ||
      `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`,
  ).trim();
  state.locationLabel =
    getCompactLocationLabel(location) || state.locationRawLabel;
  setLocationSearchInputValue(state.locationRawLabel);
  persistDiscoveryState();
  updateSelectedLocationText();
  els.locationStatus.textContent = `Showing restaurants near ${state.locationLabel}`;
  closeLocationModal();
  await resetAndReloadRestaurants();
}

async function useBrowserLocationInModal() {
  if (!navigator.geolocation) {
    showToast("Geolocation is not supported in this browser.", true);
    return;
  }

  els.mapSelectionStatus.textContent = "Getting your location...";
  showLoadingToast("Getting your location...");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      try {
        const location = await withLoading("Resolving your city...", () =>
          reverseGeocodeLocation(lat, lng),
        );
        setPendingMapLocation(
          lat,
          lng,
          location.label,
          location.shortLabel || null,
        );
        await applySelectedLocation({
          lat,
          lng,
          label: location.label,
          shortLabel: location.shortLabel || null,
        });
      } catch (_err) {
        setPendingMapLocation(
          lat,
          lng,
          `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          null,
        );
        await applySelectedLocation({
          lat,
          lng,
          label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          shortLabel: null,
        });
      } finally {
        hideLoadingToast("Getting your location...");
      }
    },
    (error) => {
      hideLoadingToast("Getting your location...");
      showToast(error.message || "Unable to retrieve your location.", true);
      els.mapSelectionStatus.textContent =
        "Location access denied. Search manually or click the map to place a pin.";
    },
  );
}

async function searchLocationInModal() {
  const query = String(
    els.modalLocationQuery.value || state.locationRawLabel || "",
  ).trim();
  if (!query) {
    showToast(
      "Use your current location or enter a city, address, or zip.",
      true,
    );
    return;
  }

  try {
    els.mapSelectionStatus.textContent = "Searching location...";
    const location = await withLoading("Searching for that location...", () =>
      searchMapLocationWithTypos(query),
    );
    setPendingMapLocation(
      location.lat,
      location.lng,
      location.label,
      location.shortLabel || null,
    );
    // Searching a place should immediately make it the active location.
    await applySelectedLocation({
      lat: location.lat,
      lng: location.lng,
      label: location.label,
      shortLabel: location.shortLabel || null,
    });
  } catch (err) {
    clearPendingMapLocation();
    showToast(err.message, true);
    els.mapSelectionStatus.textContent = "Search failed. Try another query.";
  }
}

async function confirmSelectedLocation() {
  if (!state.pendingMapLocation) {
    showToast("Choose a location on the map first.", true);
    return;
  }

  await applySelectedLocation(state.pendingMapLocation);
}

function setupInfiniteScroll() {
  if (observer) {
    observer.disconnect();
  }

  observer = new IntersectionObserver(
    (entries) => {
      const [entry] = entries;
      if (entry.isIntersecting) {
        loadMoreRestaurants().catch((err) => showToast(err.message, true));
      }
    },
    { rootMargin: "300px 0px 300px 0px" },
  );

  observer.observe(els.sentinel);
}

async function loadMoreRestaurants() {
  if (state.loading || !state.hasMore || !state.location) {
    return;
  }

  if (state.syntheticTagFallback) {
    const loadedSynthetic = takeSyntheticTagBatch(true);
    if (loadedSynthetic) {
      state.loadError = "";
      renderRestaurantList();
      renderLocationRestaurantMarkers();
      renderFeedLoader();
      return;
    }
    clearSyntheticTagFallback();
  }

  if (!state.cursor) {
    const cached = getCachedRestaurantSnapshot();
    if (cached) {
      state.restaurants = cached.restaurants;
      state.cursor = cached.cursor;
      state.hasMore = cached.hasMore;
      state.totalRestaurants = cached.totalRestaurants;
      state.loadError = "";
      renderRestaurantList();
      renderLocationRestaurantMarkers();
      renderFeedLoader();
      queueBackgroundTagRefresh();
      return;
    }
  }

  state.loading = true;
  state.loadError = "";
  renderFeedLoader();

  try {
    const loadingMessage = state.cursor
      ? "Loading more restaurants..."
      : "Loading nearby restaurants...";
    const data = await withLoading(loadingMessage, () =>
      listNearbyRestaurants({
        lat: state.location.lat,
        lng: state.location.lng,
        cursor: state.cursor || undefined,
        limit: RESTAURANTS_PAGE_SIZE,
        dietary: getRestaurantDataMode() === "local" ? [] : state.dietaryFilters,
        radiusMeters: state.searchRadiusMeters,
      }),
    );

    const nextItems = Array.isArray(data.items) ? data.items : [];
    const normalizedNextItems = enrichRestaurantListForUi(nextItems);
    const nextBaseItems = state.cursor
      ? enrichRestaurantListForUi([
          ...(restaurantResultsCache?.[baseCacheKeyForDiscoveryState()]
            ?.restaurants || state.restaurants),
          ...normalizedNextItems,
        ])
      : normalizedNextItems;
    const displayNextItems =
      getRestaurantDataMode() === "local" && state.dietaryFilters.length
        ? normalizedNextItems.map((restaurant) =>
            applySelectedTagsToRestaurant(restaurant, state.dietaryFilters),
          )
        : normalizedNextItems;
    state.restaurants = state.cursor
      ? enrichRestaurantListForUi([
          ...state.restaurants,
          ...displayNextItems,
        ])
      : displayNextItems;
    if (!displayNextItems.length && state.dietaryFilters.length) {
      const hasSyntheticPool = await ensureSyntheticTagFallbackPool();
      if (hasSyntheticPool && takeSyntheticTagBatch(false)) {
        state.loadError = "";
        renderRestaurantList();
        renderLocationRestaurantMarkers();
        renderFeedLoader();
        return;
      }
    }

    clearSyntheticTagFallback();
    state.cursor = data.nextCursor || null;
    state.hasMore = Boolean(data.hasMore);
    state.totalRestaurants = Number(data.total || state.restaurants.length);
    if (getRestaurantDataMode() === "local") {
      saveBaseRestaurantSnapshot({
        restaurants: nextBaseItems,
        cursor: data.nextCursor || null,
        hasMore: Boolean(data.hasMore),
        totalRestaurants: Number(data.total || nextBaseItems.length),
      });
    }
    saveCurrentRestaurantSnapshot();
    renderRestaurantList();
    renderLocationRestaurantMarkers();
    await persistCustomerSearchState();
    queueBackgroundTagRefresh();
  } catch (error) {
    state.loadError =
      error?.message || "Unable to load nearby restaurants right now.";
    renderRestaurantList();
    throw error;
  } finally {
    state.loading = false;
    renderFeedLoader();
  }
}

async function resetAndReloadRestaurants() {
  state.restaurants = [];
  state.loadError = "";
  state.cursor = null;
  state.hasMore = true;
  state.totalRestaurants = 0;
  state.selectedRestaurantId = null;
  clearSyntheticTagFallback();
  persistDiscoveryState();
  renderDetailsPlaceholder();
  renderRestaurantList();
  renderFeedLoader();
  if (state.location) {
    await loadMoreRestaurants();
  }
}

async function expandSearchRadius() {
  if (
    !state.location ||
    state.loading ||
    state.searchRadiusMeters >= MAX_SEARCH_RADIUS_METERS
  ) {
    return;
  }

  state.searchRadiusMeters = Math.min(
    state.searchRadiusMeters + 5000,
    MAX_SEARCH_RADIUS_METERS,
  );
  showToast(`Searching farther from ${state.locationLabel || "your area"}...`);
  state.hasMore = true;
  state.loadError = "";
  state.loading = true;
  renderFeedLoader();

  try {
    const data = await withLoading("Searching farther restaurants...", () =>
      listNearbyRestaurants({
        lat: state.location.lat,
        lng: state.location.lng,
        cursor: String(state.restaurants.length),
        limit: RESTAURANTS_PAGE_SIZE,
        dietary: getRestaurantDataMode() === "local" ? [] : state.dietaryFilters,
        radiusMeters: state.searchRadiusMeters,
        forceSync: true,
      }),
    );

    const nextItems = Array.isArray(data.items) ? data.items : [];
    const normalizedNextItems = enrichRestaurantListForUi(nextItems);
    const nextBaseItems = enrichRestaurantListForUi([
      ...(restaurantResultsCache?.[baseCacheKeyForDiscoveryState()]
        ?.restaurants || state.restaurants),
      ...normalizedNextItems,
    ]);
    const displayNextItems =
      getRestaurantDataMode() === "local" && state.dietaryFilters.length
        ? normalizedNextItems.map((restaurant) =>
            applySelectedTagsToRestaurant(restaurant, state.dietaryFilters),
          )
        : normalizedNextItems;
    state.restaurants = enrichRestaurantListForUi([
      ...state.restaurants,
      ...displayNextItems,
    ]);
    state.cursor = data.nextCursor || null;
    state.hasMore = Boolean(data.hasMore);
    state.totalRestaurants = Number(data.total || state.restaurants.length);
    if (getRestaurantDataMode() === "local") {
      saveBaseRestaurantSnapshot({
        restaurants: nextBaseItems,
        cursor: data.nextCursor || null,
        hasMore: Boolean(data.hasMore),
        totalRestaurants: Number(data.total || nextBaseItems.length),
      });
    }
    saveCurrentRestaurantSnapshot();
    renderRestaurantList();
    renderLocationRestaurantMarkers();
    await persistCustomerSearchState();
    queueBackgroundTagRefresh();
  } catch (error) {
    state.loadError = error?.message || "Unable to search farther right now.";
    renderRestaurantList();
    throw error;
  } finally {
    state.loading = false;
    renderFeedLoader();
  }
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("dark", isDark);
  els.themeToggleBtn.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
  localStorage.setItem("theme", theme);
}

function initTheme() {
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark" || savedTheme === "light") {
    applyTheme(savedTheme);
    return;
  }

  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(prefersDark ? "dark" : "light");
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function buildRestaurantPayload(form) {
  const formData = new FormData(form);
  const address = String(formData.get("address") || "").trim();
  let verifiedLocation = null;

  try {
    verifiedLocation = await searchMapLocation(address);
  } catch (_error) {
    verifiedLocation = null;
  }

  const lat = verifiedLocation?.lat ?? state.location?.lat;
  const lng = verifiedLocation?.lng ?? state.location?.lng;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(
      "Choose a location first so the restaurant can be placed correctly.",
    );
  }

  return {
    name: String(formData.get("name") || "").trim(),
    address: verifiedLocation?.label || address,
    phone: String(formData.get("phone") || "").trim(),
    website: String(formData.get("website") || "").trim(),
    openingHours: String(formData.get("openingHours") || "").trim(),
    menuUrl: String(formData.get("menuUrl") || "").trim(),
    cuisineTags: splitTags(formData.get("cuisineTags")),
    dietaryTags: splitTags(formData.get("dietaryTags")),
    description: String(formData.get("description") || "").trim(),
    lat,
    lng,
  };
}

function setFormField(form, name, value) {
  const field = form.elements.namedItem(name);
  if (field) {
    field.value = value || "";
  }
}

function populateEditForm(restaurantId) {
  const restaurant =
    state.managedRestaurants.find(
      (item) => String(item.id) === String(restaurantId),
    ) || null;
  state.selectedManagedRestaurantId = restaurant ? restaurant.id : null;

  if (!restaurant) {
    els.editRestaurantForm.reset();
    updateManagedVisibilityControls();
    return;
  }

  els.editRestaurantSelect.value = restaurant.id;
  setFormField(els.editRestaurantForm, "name", restaurant.name);
  setFormField(els.editRestaurantForm, "address", restaurant.address);
  setFormField(els.editRestaurantForm, "phone", restaurant.phone || "");
  setFormField(els.editRestaurantForm, "website", restaurant.website || "");
  setFormField(
    els.editRestaurantForm,
    "openingHours",
    restaurant.openingHours || "",
  );
  setFormField(els.editRestaurantForm, "menuUrl", restaurant.menuUrl || "");
  setFormField(
    els.editRestaurantForm,
    "cuisineTags",
    (restaurant.cuisineTags || []).join(", "),
  );
  setFormField(
    els.editRestaurantForm,
    "dietaryTags",
    (restaurant.dietaryTags || []).join(", "),
  );
  setFormField(
    els.editRestaurantForm,
    "description",
    restaurant.description || "",
  );
  updateManagedVisibilityControls();
}

function renderManagedRestaurants() {
  if (
    !state.user ||
    (state.user.role !== "owner" && state.user.role !== "moderator")
  ) {
    els.ownerRestaurantsList.innerHTML = "";
    els.editRestaurantSelect.innerHTML = "";
    els.imageRestaurantSelect.innerHTML = "";
    els.menuRestaurantSelect.innerHTML = "";
    els.moderatorUsersList.innerHTML = "";
    state.selectedManagedRestaurantId = null;
    updateManagedVisibilityControls();
    return;
  }

  if (!state.managedRestaurants.length) {
    els.ownerRestaurantsList.innerHTML =
      '<p class="muted">No managed restaurants yet. Create one to get started.</p>';
    els.editRestaurantSelect.innerHTML =
      '<option value="">No restaurants yet</option>';
    els.imageRestaurantSelect.innerHTML =
      '<option value="">No restaurants yet</option>';
    els.menuRestaurantSelect.innerHTML =
      '<option value="">No restaurants yet</option>';
    state.selectedManagedRestaurantId = null;
    updateManagedVisibilityControls();
    return;
  }

  els.ownerRestaurantsList.innerHTML = state.managedRestaurants
    .map(
      (restaurant) => `
        <button
          type="button"
          class="owner-row ${String(state.selectedManagedRestaurantId) === String(restaurant.id) ? "selected" : ""}"
          data-restaurant-id="${escapeHtml(restaurant.id)}"
        >
          <div class="owner-row-top">
            <strong>${escapeHtml(restaurant.name)}</strong>
            <span class="status-pill ${restaurant.isHidden ? "is-hidden" : "is-live"}">${
              restaurant.isHidden ? "Hidden" : "Live"
            }</span>
          </div>
          <span class="muted">${escapeHtml(restaurant.address)}</span>
        </button>
      `,
    )
    .join("");

  const options = state.managedRestaurants
    .map(
      (restaurant) =>
        `<option value="${escapeHtml(restaurant.id)}">${escapeHtml(restaurant.name)}</option>`,
    )
    .join("");

  els.editRestaurantSelect.innerHTML = options;
  els.imageRestaurantSelect.innerHTML = options;
  els.menuRestaurantSelect.innerHTML = options;

  const selectedRestaurantId =
    state.selectedManagedRestaurantId ||
    state.managedRestaurants[0]?.id ||
    null;
  if (selectedRestaurantId) {
    els.imageRestaurantSelect.value = selectedRestaurantId;
    els.menuRestaurantSelect.value = selectedRestaurantId;
    populateEditForm(selectedRestaurantId);
  }

  els.ownerRestaurantsList
    .querySelectorAll("[data-restaurant-id]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const restaurantId = button.getAttribute("data-restaurant-id");
        if (!restaurantId) {
          return;
        }

        populateEditForm(restaurantId);
        els.imageRestaurantSelect.value = restaurantId;
        els.menuRestaurantSelect.value = restaurantId;
        renderManagedRestaurants();
      });
    });

  updateManagedVisibilityControls();
}

function renderModerationUsers() {
  if (!state.user || state.user.role !== "moderator") {
    els.moderatorUsersList.innerHTML = "";
    return;
  }

  const otherUsers = state.moderationUsers.filter(
    (user) => String(user.id) !== String(state.user.id),
  );
  if (!otherUsers.length) {
    els.moderatorUsersList.innerHTML =
      '<p class="muted">No other users to moderate right now.</p>';
    return;
  }

  els.moderatorUsersList.innerHTML = otherUsers
    .map(
      (user) => `
        <div class="moderator-row">
          <div>
            <strong>${escapeHtml(user.displayName)}</strong>
            <p class="muted">${escapeHtml(user.email)} • ${escapeHtml(roleLabel(user.role))}</p>
            ${
              user.isBanned
                ? `<p class="muted">Suspended${user.bannedReason ? ` • ${escapeHtml(user.bannedReason)}` : ""}</p>`
                : ""
            }
          </div>
          <div class="owner-actions">
            <button
              type="button"
              class="btn btn-outline toggle-user-ban-btn"
              data-user-id="${escapeHtml(user.id)}"
              data-is-banned="${user.isBanned ? "true" : "false"}"
            >${user.isBanned ? "Unsuspend" : "Suspend"}</button>
            <button type="button" class="btn btn-outline delete-user-btn" data-user-id="${escapeHtml(
              user.id,
            )}">Delete User</button>
          </div>
        </div>
      `,
    )
    .join("");

  els.moderatorUsersList
    .querySelectorAll(".toggle-user-ban-btn")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const userId = button.getAttribute("data-user-id");
        const isBanned = button.getAttribute("data-is-banned") === "true";
        if (!userId) {
          return;
        }

        const reason = isBanned
          ? ""
          : window.prompt("Optional reason for suspending this account:", "") ||
            "";

        try {
          await setModerationUserBan({
            userId,
            isBanned: !isBanned,
            reason,
          });
          await refreshManagementData();
          if (state.selectedRestaurantId) {
            await loadRestaurantDetails(state.selectedRestaurantId);
          }
          showToast(isBanned ? "User unsuspended." : "User suspended.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });

  els.moderatorUsersList
    .querySelectorAll(".delete-user-btn")
    .forEach((button) => {
      button.addEventListener("click", async () => {
        const userId = button.getAttribute("data-user-id");
        if (!userId) {
          return;
        }

        if (!window.confirm("Delete this user and any restaurants they own?")) {
          return;
        }

        try {
          await deleteModerationUser(userId);
          await refreshManagementData();
          await resetAndReloadRestaurants();
          showToast("User deleted.");
        } catch (error) {
          showToast(error.message, true);
        }
      });
    });
}

async function refreshManagementData() {
  if (
    !state.user ||
    (state.user.role !== "owner" && state.user.role !== "moderator")
  ) {
    state.managedRestaurants = [];
    state.moderationUsers = [];
    renderManagedRestaurants();
    renderModerationUsers();
    return;
  }

  try {
    state.managedRestaurants = await listManagedRestaurants();
    if (state.user.role === "moderator") {
      state.moderationUsers = await listModerationUsers();
    } else {
      state.moderationUsers = [];
    }
    renderManagedRestaurants();
    renderModerationUsers();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function handleLogin(form) {
  const formData = new FormData(form);
  const user = await withLoading("Signing you in...", () =>
    signInUser({
      email: String(formData.get("email") || "").trim(),
      password: String(formData.get("password") || ""),
    }),
  );

  state.user = user;
  setFavorites(await hydrateFavoriteIds(favorites));
  closeAuthModal();
  form.reset();
  renderAuthUI();
  await refreshManagementData();
  renderRestaurantList();
  if (state.selectedRestaurantId) {
    await loadRestaurantDetails(state.selectedRestaurantId);
  }
  showToast("Welcome back.");
}

async function handleSignup(form) {
  const formData = new FormData(form);
  const user = await withLoading("Creating your account...", () =>
    signUpUser({
      displayName: String(formData.get("displayName") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      password: String(formData.get("password") || ""),
      role: String(formData.get("role") || "customer"),
    }),
  );

  state.user = user;
  setFavorites(await hydrateFavoriteIds(favorites));
  closeAuthModal();
  form.reset();
  renderAuthUI();
  await refreshManagementData();
  renderRestaurantList();
  if (state.selectedRestaurantId) {
    await loadRestaurantDetails(state.selectedRestaurantId);
  }
  showToast(`Account created for ${roleLabel(user.role)}.`);
}

function bindEvents() {
  els.openAuthBtn.addEventListener("click", openAuthModal);
  els.closeAuthModalBtn.addEventListener("click", closeAuthModal);
  els.authModal.addEventListener("click", (event) => {
    if (event.target === els.authModal) {
      closeAuthModal();
    }
  });

  els.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleLogin(els.loginForm).catch((err) => {
      els.authStatus.textContent = err.message;
      showToast(err.message, true);
    });
  });

  els.signupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    handleSignup(els.signupForm).catch((err) => {
      els.authStatus.textContent = err.message;
      showToast(err.message, true);
    });
  });

  els.logoutBtn.addEventListener("click", () => {
    signOutUser()
      .then(() => {
        state.user = null;
        state.managedRestaurants = [];
        state.moderationUsers = [];
        clearStoredSession();
        renderAuthUI();
        renderManagedRestaurants();
        renderModerationUsers();
        renderRestaurantList();
        if (state.selectedRestaurantId) {
          loadRestaurantDetails(state.selectedRestaurantId).catch((err) =>
            showToast(err.message, true),
          );
        }
        showToast("Signed out.");
      })
      .catch((err) => showToast(err.message, true));
  });

  els.openLocationModalBtn.addEventListener("click", openLocationModal);
  els.closeLocationModalBtn.addEventListener("click", closeLocationModal);
  els.locationModal.addEventListener("click", (event) => {
    if (event.target === els.locationModal) {
      closeLocationModal();
    }
  });
  els.useBrowserLocationBtn.addEventListener("click", () => {
    useBrowserLocationInModal().catch((err) => showToast(err.message, true));
  });
  els.modalSearchLocationBtn.addEventListener("click", () => {
    searchLocationInModal().catch((err) => showToast(err.message, true));
  });
  els.modalLocationQuery.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchLocationInModal().catch((err) => showToast(err.message, true));
    }
  });
  els.confirmLocationBtn.addEventListener("click", () => {
    confirmSelectedLocation().catch((err) => showToast(err.message, true));
  });

  els.dietaryFilterInputs.forEach((input) => {
    input.checked = state.dietaryFilters.includes(
      normalizeDietaryTag(input.value),
    );
    input.addEventListener("change", () => {
      state.dietaryFilters = els.dietaryFilterInputs
        .filter((item) => item.checked)
        .map((item) => normalizeDietaryTag(item.value));
      state.searchRadiusMeters = DEFAULT_SEARCH_RADIUS_METERS;

      resetAndReloadRestaurants().catch((err) => showToast(err.message, true));
    });
  });

  if (els.favoritesFilterInput) {
    els.favoritesFilterInput.checked = state.favoritesOnly;
    els.favoritesFilterInput.addEventListener("change", () => {
      state.favoritesOnly = els.favoritesFilterInput.checked;
      persistDiscoveryState();
      renderRestaurantList();
    });
  }

  els.clearFiltersBtn.addEventListener("click", () => {
    els.dietaryFilterInputs.forEach((input) => {
      input.checked = false;
    });

    if (els.favoritesFilterInput) {
      els.favoritesFilterInput.checked = false;
    }

    state.dietaryFilters = [];
    state.favoritesOnly = false;
    state.searchRadiusMeters = DEFAULT_SEARCH_RADIUS_METERS;
    resetAndReloadRestaurants().catch((err) => showToast(err.message, true));
  });

  els.themeToggleBtn.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark");
    applyTheme(isDark ? "light" : "dark");
  });

  if (els.loadMoreBtn) {
    els.loadMoreBtn.addEventListener("click", () => {
      const action = state.hasMore ? loadMoreRestaurants : expandSearchRadius;
      action().catch((err) => showToast(err.message, true));
    });
  }

  els.createRestaurantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    withLoading("Creating restaurant...", () =>
      buildRestaurantPayload(els.createRestaurantForm),
    )
      .then((payload) =>
        withLoading("Saving restaurant...", () =>
          createManagedRestaurant(payload),
        ),
      )
      .then(async () => {
        els.createRestaurantForm.reset();
        await refreshManagementData();
        await resetAndReloadRestaurants();
        showToast("Restaurant created.");
      })
      .catch((err) => showToast(err.message, true));
  });

  els.editRestaurantSelect.addEventListener("change", () => {
    populateEditForm(els.editRestaurantSelect.value);
    els.imageRestaurantSelect.value = els.editRestaurantSelect.value;
    els.menuRestaurantSelect.value = els.editRestaurantSelect.value;
    renderManagedRestaurants();
  });

  els.editRestaurantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const restaurantId = String(
      new FormData(els.editRestaurantForm).get("restaurantId") || "",
    ).trim();
    withLoading("Updating restaurant...", () =>
      buildRestaurantPayload(els.editRestaurantForm),
    )
      .then((payload) =>
        withLoading("Saving restaurant changes...", () =>
          updateManagedRestaurant({
            restaurantId,
            ...payload,
          }),
        ),
      )
      .then(async () => {
        await refreshManagementData();
        await resetAndReloadRestaurants();
        if (state.selectedRestaurantId === restaurantId) {
          await loadRestaurantDetails(restaurantId);
        }
        showToast("Restaurant updated.");
      })
      .catch((err) => showToast(err.message, true));
  });

  els.deleteRestaurantBtn.addEventListener("click", () => {
    const restaurantId = String(
      new FormData(els.editRestaurantForm).get("restaurantId") || "",
    ).trim();
    if (!restaurantId) {
      showToast("Choose a restaurant first.", true);
      return;
    }

    if (!window.confirm("Delete this restaurant and its reviews?")) {
      return;
    }

    withLoading("Deleting restaurant...", () =>
      deleteManagedRestaurant(restaurantId),
    )
      .then(async () => {
        if (state.selectedRestaurantId === restaurantId) {
          renderDetailsPlaceholder();
        }
        await refreshManagementData();
        await resetAndReloadRestaurants();
        showToast("Restaurant deleted.");
      })
      .catch((err) => showToast(err.message, true));
  });

  if (els.toggleRestaurantVisibilityBtn) {
    els.toggleRestaurantVisibilityBtn.addEventListener("click", () => {
      const restaurant = getSelectedManagedRestaurant();
      if (!restaurant) {
        showToast("Choose a restaurant first.", true);
        return;
      }

      const isHidden = Boolean(restaurant.isHidden);
      const reason = isHidden
        ? ""
        : window.prompt(
            "Optional reason for hiding this restaurant from public results:",
            restaurant.hiddenReason || "",
          ) || "";

      withLoading(
        isHidden ? "Showing restaurant again..." : "Hiding restaurant...",
        () =>
          setManagedRestaurantVisibility({
            restaurantId: restaurant.id,
            isHidden: !isHidden,
            reason,
          }),
      )
        .then(async () => {
          await refreshManagementData();
          await resetAndReloadRestaurants();
          if (state.selectedRestaurantId === restaurant.id) {
            await loadRestaurantDetails(restaurant.id);
          }
          showToast(
            isHidden
              ? "Restaurant is visible again."
              : "Restaurant hidden from public discovery.",
          );
        })
        .catch((err) => showToast(err.message, true));
    });
  }

  els.uploadImagesForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(els.uploadImagesForm);
    withLoading("Adding restaurant photo...", () =>
      addManagedRestaurantImage({
        restaurantId: String(formData.get("restaurantId") || "").trim(),
        imageUrl: String(formData.get("imageUrl") || "").trim(),
      }),
    )
      .then(async () => {
        els.uploadImagesForm.reset();
        if (state.selectedManagedRestaurantId) {
          els.imageRestaurantSelect.value = state.selectedManagedRestaurantId;
        }
        await refreshManagementData();
        await resetAndReloadRestaurants();
        showToast("Photo added.");
      })
      .catch((err) => showToast(err.message, true));
  });

  els.menuItemForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(els.menuItemForm);
    withLoading("Adding menu item...", () =>
      addManagedMenuItem({
        restaurantId: String(formData.get("restaurantId") || "").trim(),
        name: String(formData.get("name") || "").trim(),
        description: String(formData.get("description") || "").trim(),
        price: Number(formData.get("price") || 0),
        imageUrl: String(formData.get("imageUrl") || "").trim(),
      }),
    )
      .then(async () => {
        els.menuItemForm.reset();
        if (state.selectedManagedRestaurantId) {
          els.menuRestaurantSelect.value = state.selectedManagedRestaurantId;
        }
        await refreshManagementData();
        await resetAndReloadRestaurants();
        showToast("Menu item added.");
      })
      .catch((err) => showToast(err.message, true));
  });
}

async function init() {
  let restoredLoadedCount = 0;
  clearLegacyDiscoveryState();
  initTheme();
  bindEvents();
  setupInfiniteScroll();
  await silentlyInitializeCurrentLocation();
  updateSelectedLocationText();
  renderDetailsPlaceholder();
  renderRestaurantList();
  renderFeedLoader();

  els.locationStatus.textContent = state.location
    ? `Showing restaurants near ${state.locationLabel}`
    : "Use your current location or search a city to discover nearby restaurants.";
  setLocationSearchInputValue(state.locationRawLabel || state.locationLabel);

  try {
    state.user = await restoreSession();
    renderAuthUI();

    if (state.user) {
      setFavorites(await hydrateFavoriteIds(favorites));
      if (state.user.role === "customer") {
        const savedSearch = await getSavedSearchState();
        if (savedSearch) {
          state.location = {
            lat: savedSearch.lat,
            lng: savedSearch.lng,
          };
          state.locationRawLabel = savedSearch.label || "";
          state.locationLabel =
            savedSearch.shortLabel ||
            getCompactLocationLabel(savedSearch) ||
            savedSearch.label;
          state.searchRadiusMeters = Math.max(
            DEFAULT_SEARCH_RADIUS_METERS,
            Number(savedSearch.radiusMeters || DEFAULT_SEARCH_RADIUS_METERS),
          );
          restoredLoadedCount = Math.max(
            0,
            Number(savedSearch.loadedCount || 0),
          );
          state.dietaryFilters = Array.isArray(savedSearch.dietaryFilters)
            ? savedSearch.dietaryFilters.map(normalizeDietaryTag)
            : [];
          els.dietaryFilterInputs.forEach((input) => {
            input.checked = state.dietaryFilters.includes(
              normalizeDietaryTag(input.value),
            );
          });
        }
      }
      await refreshManagementData();
    }

    await resetAndReloadRestaurants();
    while (
      restoredLoadedCount > state.restaurants.length &&
      (state.hasMore || state.searchRadiusMeters < MAX_SEARCH_RADIUS_METERS)
    ) {
      if (state.hasMore) {
        await loadMoreRestaurants();
        continue;
      }

      await expandSearchRadius();
    }
  } catch (err) {
    renderDetailsPlaceholder();
    state.loadError = err?.message || "Unable to initialize the app.";
    renderRestaurantList();
    showToast(state.loadError, true);
    console.warn("App initialization warning:", err);
  }
}

init();
