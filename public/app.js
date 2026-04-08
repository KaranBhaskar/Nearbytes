import {
  getRestaurantDataMode,
  getRestaurantDataModeLabel,
  getRestaurantDetails,
  listNearbyRestaurants,
} from "./services/restaurant-service.js";

const DEFAULT_LOCATION = {
  lat: 37.7937,
  lng: -122.395,
  label: "San Francisco (default)",
};

const state = {
  loading: false,
  restaurants: [],
  cursor: null,
  hasMore: false,
  totalRestaurants: 0,
  selectedRestaurantId: null,
  pendingMapLocation: null,
  user: null,
  location: loadStoredLocation() || { lat: DEFAULT_LOCATION.lat, lng: DEFAULT_LOCATION.lng },
  locationLabel: (loadStoredLocation() || {}).label || DEFAULT_LOCATION.label,
  dietaryFilters: loadStoredJson("dietaryFilters", []),
  favoritesOnly: Boolean(loadStoredJson("favoritesOnly", false)),
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
  sentinel: document.getElementById("list-sentinel"),
  detailsPanel: document.getElementById("details-panel"),
  ownerPanel: document.getElementById("owner-panel"),
  toast: document.getElementById("toast"),
  dietaryFilterInputs: Array.from(document.querySelectorAll('input[name="dietary-filter"]')),
  clearFiltersBtn: document.getElementById("clear-filters"),
  favoritesFilterInput: document.getElementById("favorites-filter"),
};

let observer;
let locationMap = null;
let locationMarker = null;
let favorites = loadStoredJson("favorites", []);

function loadStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_err) {
    return fallback;
  }
}

function loadStoredLocation() {
  const value = loadStoredJson("lastLocation", null);
  if (!value || !Number.isFinite(value.lat) || !Number.isFinite(value.lng)) {
    return null;
  }

  return value;
}

function persistDiscoveryState() {
  localStorage.setItem("dietaryFilters", JSON.stringify(state.dietaryFilters));
  localStorage.setItem("favoritesOnly", JSON.stringify(state.favoritesOnly));
  localStorage.setItem(
    "lastLocation",
    JSON.stringify({
      lat: state.location.lat,
      lng: state.location.lng,
      label: state.locationLabel,
    }),
  );
}

function normalizeDietaryTag(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
  return normalized === "gluten_free" ? "gluten-free" : normalized;
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  const styles = getComputedStyle(document.body);
  els.toast.style.background = isError
    ? styles.getPropertyValue("--toast-error").trim()
    : styles.getPropertyValue("--toast-success").trim();

  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    els.toast.classList.add("hidden");
  }, 2800);
}

function ratingText(value, count) {
  if (!value || !count) return "No ratings yet";
  return `${Number(value).toFixed(1)} (${count})`;
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

function isFavorite(id) {
  return favorites.includes(String(id));
}

function toggleFavorite(id) {
  const normalizedId = String(id);
  if (favorites.includes(normalizedId)) {
    favorites = favorites.filter((favoriteId) => favoriteId !== normalizedId);
  } else {
    favorites.push(normalizedId);
  }

  localStorage.setItem("favorites", JSON.stringify(favorites));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

async function geocodeQuery(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const results = await fetchJson(url.toString());
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("Location not found");
  }

  const best = results[0];

  return {
    lat: Number(best.lat),
    lng: Number(best.lon),
    label: best.display_name,
    boundingBox: Array.isArray(best.boundingbox)
      ? best.boundingbox.map((value) => Number(value))
      : null,
  };
}

async function reverseGeocode(lat, lng) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "jsonv2");

  const data = await fetchJson(url.toString());
  const address = data.address || {};

  return (
    address.city ||
    address.town ||
    address.village ||
    address.state ||
    data.display_name ||
    "Unknown location"
  );
}

function renderAuthUI() {
  els.userPill.textContent = "Guest mode";
  els.openAuthBtn.textContent = "Auth Coming Next";
  els.openAuthBtn.classList.remove("hidden");
  els.logoutBtn.classList.add("hidden");
  els.ownerPanel.classList.add("hidden");
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
  const label = state.locationLabel || DEFAULT_LOCATION.label;

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

function renderRestaurantCard(restaurant) {
  const card = document.createElement("article");
  card.className = "restaurant-card";

  if (state.selectedRestaurantId === restaurant.id) {
    card.classList.add("selected");
  }

  const dietaryTagsHtml = (restaurant.dietaryTags || [])
    .map((tag) => `<span class="metric-pill">${titleCaseWords(tag)}</span>`)
    .join("");

  const sourceLabel =
    restaurant.source === "fallback" ? "Demo fallback" : titleCaseWords(restaurant.source);

  const imageSrc =
    restaurant.coverImage || "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=80";

  card.innerHTML = `
    <button class="fav-btn ${isFavorite(restaurant.id) ? "active" : ""}" data-id="${restaurant.id}">🔖</button>
    <img src="${imageSrc}" alt="${restaurant.name}" loading="lazy" />
    <div class="restaurant-card-body">
      <h3>${restaurant.name}</h3>
      <p class="muted">${restaurant.address}</p>
      <div class="metrics">
        <span class="metric-pill">${restaurant.distanceKm.toFixed(2)} km away</span>
        ${dietaryTagsHtml}
        <span class="metric-pill">Combined: ${ratingText(
          restaurant.combinedRating,
          restaurant.combinedRatingCount,
        )}</span>
        <span class="metric-pill">${sourceLabel}</span>
      </div>
    </div>
  `;

  card.addEventListener("click", () => {
    state.selectedRestaurantId = restaurant.id;
    renderRestaurantList();
    loadRestaurantDetails(restaurant.id).catch((err) => showToast(err.message, true));
  });

  const favoriteButton = card.querySelector(".fav-btn");
  favoriteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(restaurant.id);
    favoriteButton.classList.toggle("active", isFavorite(restaurant.id));

    if (state.selectedRestaurantId === restaurant.id) {
      const detailFavoriteButton = els.detailsPanel.querySelector(".fav-btn.large");
      if (detailFavoriteButton) {
        detailFavoriteButton.classList.toggle("active", isFavorite(restaurant.id));
      }
    }

    if (state.favoritesOnly) {
      renderRestaurantList();
    }
  });

  return card;
}

function renderRestaurantList() {
  els.list.innerHTML = "";
  updateFeedMeta();

  const restaurants = getFilteredRestaurants();

  if (!restaurants.length && !state.loading) {
    els.list.innerHTML = '<p class="muted">No restaurants found for this location.</p>';
    return;
  }

  restaurants.forEach((restaurant) => {
    els.list.appendChild(renderRestaurantCard(restaurant));
  });
}

function renderFeedLoader() {
  if (state.loading) {
    els.listLoader.textContent = "Loading restaurants...";
    return;
  }

  if (!state.hasMore && state.restaurants.length > 0) {
    els.listLoader.textContent = "No more restaurants to load.";
    return;
  }

  els.listLoader.textContent = "";
}

function renderDetailsPlaceholder() {
  els.detailsPanel.innerHTML =
    "<h2>Restaurant Details</h2><p class=\"muted\">Select a restaurant to view menu and photos.</p>";
}

async function loadRestaurantDetails(restaurantId) {
  const detail = await getRestaurantDetails({
    id: restaurantId,
    originLat: state.location.lat,
    originLng: state.location.lng,
  });

  if (!detail) {
    throw new Error("Restaurant not found");
  }

  const restaurant = detail.restaurant;
  const images = detail.images || [];
  const menuItems = detail.menuItems || [];

  els.detailsPanel.innerHTML = `
    <div style="position: relative;">
      <h2>${restaurant.name}</h2>
      <button class="fav-btn large ${isFavorite(restaurant.id) ? "active" : ""}" data-id="${restaurant.id}">🔖</button>
    </div>
    <p class="muted">${restaurant.address}</p>
    <p>${restaurant.description || "No description provided yet."}</p>

    <div class="metrics">
      ${(restaurant.dietaryTags || [])
        .map((tag) => `<span class="metric-pill">${titleCaseWords(tag)}</span>`)
        .join("")}
      <span class="metric-pill">Combined: ${ratingText(
        restaurant.combinedRating,
        restaurant.combinedRatingCount,
      )}</span>
      <span class="metric-pill">${
        restaurant.source === "fallback" ? "Demo fallback data" : titleCaseWords(restaurant.source)
      }</span>
    </div>

    <h3>Information</h3>
    <div>
      <p><strong>Address:</strong> ${restaurant.address}</p>
      ${restaurant.phone ? `<p><strong>Phone:</strong> ${restaurant.phone}</p>` : ""}
      ${
        restaurant.website
          ? `<p><strong>Website:</strong> <a href="${restaurant.website}" target="_blank" rel="noreferrer">${restaurant.website}</a></p>`
          : ""
      }
      ${restaurant.openingHours ? `<p><strong>Hours:</strong> ${restaurant.openingHours}</p>` : ""}
    </div>

    <h3>Gallery</h3>
    <div class="detail-gallery">
      ${
        images.length
          ? images.map((image) => `<img src="${image.url}" alt="${restaurant.name}" loading="lazy" />`).join("")
          : '<p class="muted">No photos yet.</p>'
      }
    </div>

    <h3>Menu</h3>
    <div>
      ${
        menuItems.length
          ? menuItems
              .map(
                (item) => `
                  <div class="menu-item">
                    <strong>${item.name}</strong> - $${Number(item.price).toFixed(2)}
                    <p class="muted">${item.description || ""}</p>
                  </div>
                `,
              )
              .join("")
          : restaurant.menuUrl
            ? `<p><a href="${restaurant.menuUrl}" target="_blank" rel="noreferrer">View restaurant menu</a></p>`
            : '<p class="muted">No menu items yet.</p>'
      }
    </div>

    <h3>Reviews</h3>
    <p class="muted">Auth and reviews are the next migration step. Discovery currently runs through ${getRestaurantDataModeLabel()}.</p>
  `;

  const detailFavoriteButton = els.detailsPanel.querySelector(".fav-btn.large");
  detailFavoriteButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFavorite(restaurant.id);
    detailFavoriteButton.classList.toggle("active", isFavorite(restaurant.id));
    renderRestaurantList();
  });
}

function updateSelectedLocationText() {
  els.selectedLocationText.textContent = state.locationLabel || "None selected";
}

function openLocationModal() {
  els.locationModal.classList.remove("hidden");
  window.setTimeout(initLocationMap, 0);
}

function closeLocationModal() {
  els.locationModal.classList.add("hidden");
}

function setPendingMapLocation(lat, lng, label = null) {
  state.pendingMapLocation = { lat, lng, label };

  if (!locationMarker) {
    locationMarker = L.marker([lat, lng], { draggable: true }).addTo(locationMap);

    locationMarker.on("dragend", async () => {
      const position = locationMarker.getLatLng();
      state.pendingMapLocation = {
        lat: position.lat,
        lng: position.lng,
        label: state.pendingMapLocation?.label || "Pinned location",
      };

      try {
        const readable = await reverseGeocode(position.lat, position.lng);
        state.pendingMapLocation.label = readable;
        els.mapSelectionStatus.textContent = `Selected: ${readable}`;
      } catch (_err) {
        els.mapSelectionStatus.textContent = `Selected pin at ${position.lat.toFixed(5)}, ${position.lng.toFixed(5)}`;
      }
    });
  } else {
    locationMarker.setLatLng([lat, lng]);
  }

  locationMap.setView([lat, lng], 14);
  els.mapSelectionStatus.textContent = label
    ? `Selected: ${label}`
    : `Selected pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function initLocationMap() {
  if (!locationMap) {
    locationMap = L.map("location-map").setView([DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lng], 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(locationMap);

    locationMap.on("click", async (event) => {
      const { lat, lng } = event.latlng;
      setPendingMapLocation(lat, lng);

      try {
        const readable = await reverseGeocode(lat, lng);
        state.pendingMapLocation.label = readable;
        els.mapSelectionStatus.textContent = `Selected: ${readable}`;
      } catch (_err) {
        els.mapSelectionStatus.textContent = `Selected pin at ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      }
    });
  }

  window.setTimeout(() => {
    locationMap.invalidateSize();
  }, 100);

  setPendingMapLocation(state.location.lat, state.location.lng, state.locationLabel);
}

async function useBrowserLocationInModal() {
  if (!navigator.geolocation) {
    showToast("Geolocation is not supported in this browser.", true);
    return;
  }

  els.mapSelectionStatus.textContent = "Getting your location...";

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      try {
        const readable = await reverseGeocode(lat, lng);
        setPendingMapLocation(lat, lng, readable);
        state.pendingMapLocation.label = readable;
      } catch (_err) {
        setPendingMapLocation(lat, lng, "Your current location");
      }
    },
    (error) => {
      showToast(error.message || "Unable to retrieve your location.", true);
      els.mapSelectionStatus.textContent =
        "Location access denied. Search manually or click the map to place a pin.";
    },
  );
}

async function searchLocationInModal() {
  const query = String(els.modalLocationQuery.value || "").trim();
  if (!query) {
    showToast("Enter a city, address, or zip.", true);
    return;
  }

  try {
    els.mapSelectionStatus.textContent = "Searching location...";
    const location = await geocodeQuery(query);
    setPendingMapLocation(location.lat, location.lng, location.label);
  } catch (err) {
    showToast(err.message, true);
    els.mapSelectionStatus.textContent = "Search failed. Try another query.";
  }
}

async function confirmSelectedLocation() {
  if (!state.pendingMapLocation) {
    showToast("Choose a location on the map first.", true);
    return;
  }

  state.location = {
    lat: state.pendingMapLocation.lat,
    lng: state.pendingMapLocation.lng,
  };
  state.locationLabel = state.pendingMapLocation.label || "Selected area";
  persistDiscoveryState();
  updateSelectedLocationText();
  els.locationStatus.textContent = `Showing restaurants near ${state.locationLabel}`;
  closeLocationModal();

  await resetAndReloadRestaurants();
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
  if (state.loading || !state.hasMore) {
    return;
  }

  state.loading = true;
  renderFeedLoader();

  try {
    const data = await listNearbyRestaurants({
      lat: state.location.lat,
      lng: state.location.lng,
      cursor: state.cursor || undefined,
      limit: 20,
      dietary: state.dietaryFilters,
    });

    const nextItems = Array.isArray(data.items) ? data.items : [];
    state.restaurants = state.cursor ? [...state.restaurants, ...nextItems] : nextItems;
    state.cursor = data.nextCursor || null;
    state.hasMore = Boolean(data.hasMore);
    state.totalRestaurants = Number(data.total || state.restaurants.length);
    renderRestaurantList();
  } finally {
    state.loading = false;
    renderFeedLoader();
  }
}

async function resetAndReloadRestaurants() {
  state.restaurants = [];
  state.cursor = null;
  state.hasMore = true;
  state.totalRestaurants = 0;
  state.selectedRestaurantId = null;
  persistDiscoveryState();
  renderDetailsPlaceholder();
  renderRestaurantList();
  renderFeedLoader();
  await loadMoreRestaurants();
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

function bindEvents() {
  els.openAuthBtn.addEventListener("click", () => {
    showToast(
      `Auth is the next migration step. Discovery currently runs through ${getRestaurantDataModeLabel()}.`,
    );
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
    input.checked = state.dietaryFilters.includes(normalizeDietaryTag(input.value));
    input.addEventListener("change", () => {
      state.dietaryFilters = els.dietaryFilterInputs
        .filter((item) => item.checked)
        .map((item) => normalizeDietaryTag(item.value));

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
    resetAndReloadRestaurants().catch((err) => showToast(err.message, true));
  });

  els.themeToggleBtn.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark");
    applyTheme(isDark ? "light" : "dark");
  });
}

async function init() {
  initTheme();
  renderAuthUI();
  bindEvents();
  setupInfiniteScroll();
  updateSelectedLocationText();
  renderDetailsPlaceholder();
  renderRestaurantList();
  renderFeedLoader();

  els.locationStatus.textContent = `Showing restaurants near ${state.locationLabel}`;

  try {
    await resetAndReloadRestaurants();
    if (getRestaurantDataMode() === "local") {
      showToast("Running in local demo mode. UI work can continue without Convex.");
    }
  } catch (err) {
    renderDetailsPlaceholder();
    showToast(err.message, true);
  }
}

init();
