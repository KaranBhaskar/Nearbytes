import {
  addManagedMenuItem,
  addManagedRestaurantImage,
  clearStoredSession,
  createManagedRestaurant,
  deleteManagedRestaurant,
  deleteModerationUser,
  deleteRestaurantReview,
  getRestaurantDataMode,
  getRestaurantDataModeLabel,
  getRestaurantDetails,
  hydrateFavoriteIds,
  listManagedRestaurants,
  listModerationUsers,
  listNearbyRestaurants,
  restoreSession,
  setFavoriteRestaurant,
  signInUser,
  signOutUser,
  signUpUser,
  upsertRestaurantReview,
  updateManagedRestaurant,
} from "./services/restaurant-service.js";

const DEFAULT_LOCATION = {
  lat: 37.7937,
  lng: -122.395,
  label: "San Francisco (default)",
};

const FALLBACK_IMAGE =
  "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=80";

const state = {
  loading: false,
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
  ownerPanelTitle: document.getElementById("owner-panel-title"),
  ownerPanelCopy: document.getElementById("owner-panel-copy"),
  toast: document.getElementById("toast"),
  dietaryFilterInputs: Array.from(document.querySelectorAll('input[name="dietary-filter"]')),
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

function persistFavorites() {
  localStorage.setItem("favorites", JSON.stringify(favorites));
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

async function toggleFavorite(id) {
  const normalizedId = String(id);
  const nextValue = !favorites.includes(normalizedId);

  if (
    state.user &&
    getRestaurantDataMode() === "convex" &&
    !normalizedId.startsWith("demo-")
  ) {
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
      state.user.role === "moderator" ? "Moderator Dashboard" : "Owner Dashboard";
    els.ownerPanelCopy.textContent =
      state.user.role === "moderator"
        ? "Delete restaurants, remove reviews, and manage user access without changing the rest of the UI."
        : "Create listings, update menus, add photo URLs, and delete restaurants you own.";
    els.moderatorUsersCard.classList.toggle("hidden", state.user.role !== "moderator");
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

function buildSafeImage(url) {
  return safeUrl(url) || FALLBACK_IMAGE;
}

function renderRestaurantCard(restaurant) {
  const card = document.createElement("article");
  card.className = "restaurant-card";

  if (state.selectedRestaurantId === restaurant.id) {
    card.classList.add("selected");
  }

  const dietaryTagsHtml = (restaurant.dietaryTags || [])
    .map((tag) => `<span class="metric-pill">${escapeHtml(titleCaseWords(tag))}</span>`)
    .join("");

  const sourceLabel =
    restaurant.source === "fallback" ? "Demo fallback" : titleCaseWords(restaurant.source);

  card.innerHTML = `
    <button class="fav-btn ${isFavorite(restaurant.id) ? "active" : ""}" data-id="${escapeHtml(
      restaurant.id,
    )}">🔖</button>
    <img src="${escapeHtml(buildSafeImage(restaurant.coverImage))}" alt="${escapeHtml(
      restaurant.name,
    )}" loading="lazy" />
    <div class="restaurant-card-body">
      <h3>${escapeHtml(restaurant.name)}</h3>
      <p class="muted">${escapeHtml(restaurant.address)}</p>
      <div class="metrics">
        <span class="metric-pill">${restaurant.distanceKm.toFixed(2)} km away</span>
        ${dietaryTagsHtml}
        <span class="metric-pill">Combined: ${escapeHtml(
          ratingText(restaurant.combinedRating, restaurant.combinedRatingCount),
        )}</span>
        <span class="metric-pill">${escapeHtml(sourceLabel)}</span>
      </div>
    </div>
  `;

  card.addEventListener("click", () => {
    state.selectedRestaurantId = restaurant.id;
    renderRestaurantList();
    loadRestaurantDetails(restaurant.id).catch((err) => showToast(err.message, true));
  });

  const favoriteButton = card.querySelector(".fav-btn");
  favoriteButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    try {
      await toggleFavorite(restaurant.id);
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
  state.currentDetail = null;
  els.detailsPanel.innerHTML =
    "<h2>Restaurant Details</h2><p class=\"muted\">Select a restaurant to view menu, photos, and reviews.</p>";
}

function reviewStarsText(rating) {
  return `${"★".repeat(rating)}${"☆".repeat(Math.max(0, 5 - rating))}`;
}

function renderReviewComposer(detail) {
  if (!state.user) {
    return `<p class="muted">Sign in to save favorites to your account and leave a review.</p>`;
  }

  if (!detail.permissions?.canReview) {
    return `<p class="muted">Reviews are unavailable while discovery is running in ${escapeHtml(
      getRestaurantDataModeLabel(),
    )}.</p>`;
  }

  const myReview = detail.myReview;
  const reviewText = escapeHtml(myReview?.comment || "");
  const selectedRating = Number(myReview?.rating || state.pendingReviewRating || 0);
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
        detailFavoriteButton.classList.toggle("active", isFavorite(detail.restaurant.id));
        renderRestaurantList();
      } catch (error) {
        showToast(error.message, true);
      }
    });
  }

  const reviewStars = Array.from(els.detailsPanel.querySelectorAll(".star-btn"));
  const reviewStarsContainer = els.detailsPanel.querySelector("#review-stars");
  const reviewForm = els.detailsPanel.querySelector("#review-form");
  const deleteOwnReviewBtn = els.detailsPanel.querySelector("#delete-own-review");

  const refreshStarButtons = () => {
    reviewStars.forEach((button) => {
      const rating = Number(button.dataset.rating || 0);
      button.classList.toggle("active", rating <= state.pendingReviewRating);
    });
    if (reviewStarsContainer) {
      reviewStarsContainer.classList.toggle("error", state.pendingReviewRating <= 0);
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
}

async function loadRestaurantDetails(restaurantId) {
  state.selectedRestaurantId = restaurantId;
  renderRestaurantList();
  const detail = await getRestaurantDetails({
    id: restaurantId,
    originLat: state.location.lat,
    originLng: state.location.lng,
  });

  if (!detail) {
    throw new Error("Restaurant not found");
  }

  state.currentDetail = detail;
  state.pendingReviewRating = Number(detail.myReview?.rating || 0);

  const restaurant = detail.restaurant;
  const websiteUrl = safeUrl(restaurant.website);
  const menuUrl = safeUrl(restaurant.menuUrl);
  const images = detail.images || [];
  const menuItems = detail.menuItems || [];

  els.detailsPanel.innerHTML = `
    <div style="position: relative;">
      <h2>${escapeHtml(restaurant.name)}</h2>
      <button class="fav-btn large ${isFavorite(restaurant.id) ? "active" : ""}" data-id="${escapeHtml(
        restaurant.id,
      )}">🔖</button>
    </div>
    <p class="muted">${escapeHtml(restaurant.address)}</p>
    <p>${escapeHtml(restaurant.description || "No description provided yet.")}</p>

    <div class="metrics">
      ${(restaurant.dietaryTags || [])
        .map((tag) => `<span class="metric-pill">${escapeHtml(titleCaseWords(tag))}</span>`)
        .join("")}
      <span class="metric-pill">Combined: ${escapeHtml(
        ratingText(restaurant.combinedRating, restaurant.combinedRatingCount),
      )}</span>
      <span class="metric-pill">${escapeHtml(
        restaurant.source === "fallback" ? "Demo fallback data" : titleCaseWords(restaurant.source),
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
      ${restaurant.openingHours ? `<p><strong>Hours:</strong> ${escapeHtml(restaurant.openingHours)}</p>` : ""}
    </div>

    <h3>Gallery</h3>
    <div class="detail-gallery">
      ${
        images.length
          ? images
              .map(
                (image) =>
                  `<img src="${escapeHtml(buildSafeImage(image.url))}" alt="${escapeHtml(
                    restaurant.name,
                  )}" loading="lazy" />`,
              )
              .join("")
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
                    <div>
                      <strong>${escapeHtml(item.name)}</strong>
                      <p class="muted">${escapeHtml(item.description || "")}</p>
                    </div>
                    <span>$${Number(item.price).toFixed(2)}</span>
                  </div>
                `,
              )
              .join("")
          : menuUrl
            ? `<p><a href="${escapeHtml(menuUrl)}" target="_blank" rel="noreferrer">View restaurant menu</a></p>`
            : '<p class="muted">No menu items yet.</p>'
      }
    </div>

    <h3>Reviews</h3>
    ${renderReviewComposer(detail)}
    <div class="review-list">${renderReviewsList(detail)}</div>
  `;

  bindDetailsEvents(detail);
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

function openAuthModal() {
  if (getRestaurantDataMode() === "local" && !window.__APP_CONFIG__?.convexUrl) {
    showToast("Auth requires the Convex backend to be configured.", true);
    return;
  }

  els.authStatus.textContent =
    "Customers save favorites and leave reviews. Owners manage listings. Moderators remove reviews, restaurants, and users.";
  els.authModal.classList.remove("hidden");
}

function closeAuthModal() {
  els.authModal.classList.add("hidden");
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

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildRestaurantPayload(form) {
  const formData = new FormData(form);
  return {
    name: String(formData.get("name") || "").trim(),
    address: String(formData.get("address") || "").trim(),
    phone: String(formData.get("phone") || "").trim(),
    website: String(formData.get("website") || "").trim(),
    openingHours: String(formData.get("openingHours") || "").trim(),
    menuUrl: String(formData.get("menuUrl") || "").trim(),
    cuisineTags: splitTags(formData.get("cuisineTags")),
    dietaryTags: splitTags(formData.get("dietaryTags")),
    description: String(formData.get("description") || "").trim(),
    lat: state.location.lat,
    lng: state.location.lng,
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
    state.managedRestaurants.find((item) => String(item.id) === String(restaurantId)) || null;
  state.selectedManagedRestaurantId = restaurant ? restaurant.id : null;

  if (!restaurant) {
    els.editRestaurantForm.reset();
    return;
  }

  els.editRestaurantSelect.value = restaurant.id;
  setFormField(els.editRestaurantForm, "name", restaurant.name);
  setFormField(els.editRestaurantForm, "address", restaurant.address);
  setFormField(els.editRestaurantForm, "phone", restaurant.phone || "");
  setFormField(els.editRestaurantForm, "website", restaurant.website || "");
  setFormField(els.editRestaurantForm, "openingHours", restaurant.openingHours || "");
  setFormField(els.editRestaurantForm, "menuUrl", restaurant.menuUrl || "");
  setFormField(els.editRestaurantForm, "cuisineTags", (restaurant.cuisineTags || []).join(", "));
  setFormField(els.editRestaurantForm, "dietaryTags", (restaurant.dietaryTags || []).join(", "));
  setFormField(els.editRestaurantForm, "description", restaurant.description || "");
}

function renderManagedRestaurants() {
  if (!state.user || (state.user.role !== "owner" && state.user.role !== "moderator")) {
    els.ownerRestaurantsList.innerHTML = "";
    els.editRestaurantSelect.innerHTML = "";
    els.imageRestaurantSelect.innerHTML = "";
    els.menuRestaurantSelect.innerHTML = "";
    els.moderatorUsersList.innerHTML = "";
    return;
  }

  if (!state.managedRestaurants.length) {
    els.ownerRestaurantsList.innerHTML =
      '<p class="muted">No managed restaurants yet. Create one to get started.</p>';
    els.editRestaurantSelect.innerHTML = '<option value="">No restaurants yet</option>';
    els.imageRestaurantSelect.innerHTML = '<option value="">No restaurants yet</option>';
    els.menuRestaurantSelect.innerHTML = '<option value="">No restaurants yet</option>';
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
          <strong>${escapeHtml(restaurant.name)}</strong>
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
    state.selectedManagedRestaurantId || state.managedRestaurants[0]?.id || null;
  if (selectedRestaurantId) {
    els.imageRestaurantSelect.value = selectedRestaurantId;
    els.menuRestaurantSelect.value = selectedRestaurantId;
    populateEditForm(selectedRestaurantId);
  }

  els.ownerRestaurantsList.querySelectorAll("[data-restaurant-id]").forEach((button) => {
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
}

function renderModerationUsers() {
  if (!state.user || state.user.role !== "moderator") {
    els.moderatorUsersList.innerHTML = "";
    return;
  }

  const otherUsers = state.moderationUsers.filter((user) => String(user.id) !== String(state.user.id));
  if (!otherUsers.length) {
    els.moderatorUsersList.innerHTML = '<p class="muted">No other users to moderate right now.</p>';
    return;
  }

  els.moderatorUsersList.innerHTML = otherUsers
    .map(
      (user) => `
        <div class="moderator-row">
          <div>
            <strong>${escapeHtml(user.displayName)}</strong>
            <p class="muted">${escapeHtml(user.email)} • ${escapeHtml(roleLabel(user.role))}</p>
          </div>
          <button type="button" class="btn btn-outline delete-user-btn" data-user-id="${escapeHtml(
            user.id,
          )}">Delete User</button>
        </div>
      `,
    )
    .join("");

  els.moderatorUsersList.querySelectorAll(".delete-user-btn").forEach((button) => {
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
  if (!state.user || (state.user.role !== "owner" && state.user.role !== "moderator")) {
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
  const user = await signInUser({
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || ""),
  });

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
  const user = await signUpUser({
    displayName: String(formData.get("displayName") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || ""),
    role: String(formData.get("role") || "customer"),
  });

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
          loadRestaurantDetails(state.selectedRestaurantId).catch((err) => showToast(err.message, true));
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

  els.createRestaurantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    createManagedRestaurant(buildRestaurantPayload(els.createRestaurantForm))
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
    const restaurantId = String(new FormData(els.editRestaurantForm).get("restaurantId") || "").trim();
    updateManagedRestaurant({
      restaurantId,
      ...buildRestaurantPayload(els.editRestaurantForm),
    })
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
    const restaurantId = String(new FormData(els.editRestaurantForm).get("restaurantId") || "").trim();
    if (!restaurantId) {
      showToast("Choose a restaurant first.", true);
      return;
    }

    if (!window.confirm("Delete this restaurant and its reviews?")) {
      return;
    }

    deleteManagedRestaurant(restaurantId)
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

  els.uploadImagesForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(els.uploadImagesForm);
    addManagedRestaurantImage({
      restaurantId: String(formData.get("restaurantId") || "").trim(),
      imageUrl: String(formData.get("imageUrl") || "").trim(),
    })
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
    addManagedMenuItem({
      restaurantId: String(formData.get("restaurantId") || "").trim(),
      name: String(formData.get("name") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      price: Number(formData.get("price") || 0),
      imageUrl: String(formData.get("imageUrl") || "").trim(),
    })
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
  initTheme();
  bindEvents();
  setupInfiniteScroll();
  updateSelectedLocationText();
  renderDetailsPlaceholder();
  renderRestaurantList();
  renderFeedLoader();

  els.locationStatus.textContent = `Showing restaurants near ${state.locationLabel}`;

  try {
    state.user = await restoreSession();
    renderAuthUI();

    if (state.user) {
      setFavorites(await hydrateFavoriteIds(favorites));
      await refreshManagementData();
    }

    await resetAndReloadRestaurants();
    if (getRestaurantDataMode() === "local") {
      showToast("Running in local demo mode. Backend auth and reviews need Convex to be reachable.");
    }
  } catch (err) {
    renderDetailsPlaceholder();
    showToast(err.message, true);
  }
}

init();
