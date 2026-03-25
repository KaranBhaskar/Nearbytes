const state = {
  token: localStorage.getItem('token') || null,
  user: localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')) : null,
  location: null,
  locationLabel: null,
  cursor: null,
  hasMore: false,
  loading: false,
  restaurants: [],
  selectedRestaurantId: null,
  ownerRestaurants: [],
  selectedOwnerRestaurantId: null,
  dietaryFilters: [],
  pendingMapLocation: null,
};

const demoRestaurants = [
  {
    id: 9001,
    name: "Green Garden Bistro",
    address: "123 Market St, San Francisco",
    description: "Fresh vegetarian meals made with local ingredients.",
    rating: 4.6,
    cuisineTags: ["Vegetarian", "Healthy"],
    dietaryTags: ["vegan", "gluten-free"],
    image:
      "https://images.unsplash.com/photo-1546069901-ba9599a7e63c"
  },
  {
    id: 9002,
    name: "Spice Route Indian Kitchen",
    address: "456 Mission St, San Francisco",
    description: "Authentic Indian cuisine with rich spices and flavors.",
    rating: 4.4,
    cuisineTags: ["Indian", "Curry"],
    dietaryTags: ["halal"],
    image:
      "https://images.unsplash.com/photo-1601050690597-df0568f70950"
  },
  {
    id: 9003,
    name: "Bella Italia Trattoria",
    address: "789 Castro St, San Francisco",
    description: "Traditional Italian pasta, pizza, and wine.",
    rating: 4.7,
    cuisineTags: ["Italian", "Pasta", "Pizza"],
    dietaryTags: [],
    image:
      "https://images.unsplash.com/photo-1600891964599-f61ba0e24092"
  }
];

const CITY_SEARCH_RADIUS_METERS = 20000;
const EXTERNAL_RESTAURANT_LIMIT = 40;

const els = {
  userPill: document.getElementById('user-pill'),
  openAuthBtn: document.getElementById('open-auth'),
  logoutBtn: document.getElementById('logout-btn'),
  themeToggleBtn: document.getElementById('theme-toggle'),
  openLocationModalBtn: document.getElementById('open-location-modal'),
  selectedLocationText: document.getElementById('selected-location-text'),
  locationModal: document.getElementById('location-modal'),
  closeLocationModalBtn: document.getElementById('close-location-modal'),
  useBrowserLocationBtn: document.getElementById('use-browser-location'),
  modalLocationQuery: document.getElementById('modal-location-query'),
  modalSearchLocationBtn: document.getElementById('modal-search-location'),
  mapSelectionStatus: document.getElementById('map-selection-status'),
  confirmLocationBtn: document.getElementById('confirm-location'),
  locationStatus: document.getElementById('location-status'),
  feedMeta: document.getElementById('feed-meta'),
  list: document.getElementById('restaurant-list'),
  listLoader: document.getElementById('list-loader'),
  sentinel: document.getElementById('list-sentinel'),
  detailsPanel: document.getElementById('details-panel'),
  toast: document.getElementById('toast'),
  ownerPanel: document.getElementById('owner-panel'),
  ownerRestaurantsList: document.getElementById('owner-restaurants-list'),
  createRestaurantForm: document.getElementById('create-restaurant-form'),
  editRestaurantForm: document.getElementById('edit-restaurant-form'),
  uploadImagesForm: document.getElementById('upload-images-form'),
  menuItemForm: document.getElementById('menu-item-form'),
  editRestaurantSelect: document.getElementById('edit-restaurant-select'),
  imageRestaurantSelect: document.getElementById('image-restaurant-select'),
  menuRestaurantSelect: document.getElementById('menu-restaurant-select'),
  dietaryFilterInputs: Array.from(document.querySelectorAll('input[name="dietary-filter"]')),
  clearFiltersBtn: document.getElementById('clear-filters'),
};

let observer;
let locationMap = null;
let locationMarker = null;

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  els.toast.style.background = isError ? '#8e2410' : '#1a1f1d';
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 2600);
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  if (state.token) {
    headers.set('Authorization', `Bearer ${state.token}`);
  }

  const response = await fetch(path, {
    ...options,
    headers,
    body:
      options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_err) {
    data = null;
  }

  if (!response.ok) {
    const message = data && data.error ? data.error : 'Request failed';
    throw new Error(message);
  }

  return data;
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

function titleCaseWords(value) {
  return String(value || '')
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseCuisineList(value) {
  return String(value || '')
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => titleCaseWords(item));
}

function inferDietaryTags(tags = {}) {
  const dietaryTags = [];

  if (tags['diet:vegan'] === 'yes') dietaryTags.push('vegan');
  if (tags['diet:vegetarian'] === 'yes') dietaryTags.push('vegetarian');
  if (tags['diet:halal'] === 'yes') dietaryTags.push('halal');
  if (tags['diet:kosher'] === 'yes') dietaryTags.push('kosher');
  if (tags['diet:gluten_free'] === 'yes') dietaryTags.push('gluten-free');

  return dietaryTags;
}

function buildAddressFromTags(tags = {}) {
  const parts = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:city'] || tags['addr:town'] || tags['addr:village'],
    tags['addr:state'],
    tags['addr:postcode'],
  ]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+,/g, ',')
    .trim();

  return parts || tags['addr:full'] || 'Address not available';
}

function normalizeExternalRestaurant(element, originLat, originLng) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  const name = String(tags.name || '').trim();

  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const cuisineTags = parseCuisineList(tags.cuisine);
  const dietaryTags = inferDietaryTags(tags);

  return {
    id: `osm-${element.type}-${element.id}`,
    ownerId: null,
    name,
    address: buildAddressFromTags(tags),
    lat,
    lng,
    description:
      tags.description ||
      `Community-listed restaurant near ${state.locationLabel || 'your selected city'}.`,
    phone: tags.phone || tags['contact:phone'] || null,
    website: tags.website || tags['contact:website'] || null,
    cuisineTags,
    dietaryTags,
    googlePlaceId: null,
    coverImage: null,
    googleRating: null,
    googleRatingCount: 0,
    appRating: null,
    appRatingCount: 0,
    combinedRating: null,
    combinedRatingCount: 0,
    distanceKm: haversineKm(originLat, originLng, lat, lng),
    externalSource: 'openstreetmap',
    openingHours: tags.opening_hours || null,
  };
}

async function fetchExternalRestaurants(lat, lng) {
  const query = `
[out:json][timeout:20];
(
  node["amenity"="restaurant"](around:${CITY_SEARCH_RADIUS_METERS},${lat},${lng});
  way["amenity"="restaurant"](around:${CITY_SEARCH_RADIUS_METERS},${lat},${lng});
  relation["amenity"="restaurant"](around:${CITY_SEARCH_RADIUS_METERS},${lat},${lng});
);
out center tags;
`;

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({ data: query }),
  });

  if (!response.ok) {
    throw new Error('Failed to load city restaurants');
  }

  const data = await response.json();
  const seen = new Set();

  return (data.elements || [])
    .map((element) => normalizeExternalRestaurant(element, lat, lng))
    .filter(Boolean)
    .filter((restaurant) => {
      const key = `${restaurant.name.toLowerCase()}|${restaurant.address.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, EXTERNAL_RESTAURANT_LIMIT);
}

function saveAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function clearAuth() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

function navigateToAuthPage() {
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/auth.html?returnTo=${encodeURIComponent(returnTo)}`);
}

function renderAuthUI() {
  if (state.user) {
    els.userPill.textContent = `${state.user.name} (${state.user.role})`;
    els.openAuthBtn.classList.add('hidden');
    els.logoutBtn.classList.remove('hidden');
  } else {
    els.userPill.textContent = 'Guest';
    els.openAuthBtn.classList.remove('hidden');
    els.logoutBtn.classList.add('hidden');
  }

  const showOwner = state.user && state.user.role === 'owner';
  els.ownerPanel.classList.toggle('hidden', !showOwner);

  if (showOwner) {
    loadOwnerRestaurants().catch((err) => showToast(err.message, true));
  }
}

function ratingText(value, count) {
  if (!value || !count) return 'No ratings yet';
  return `${Number(value).toFixed(1)} (${count})`;
}

function activeDietaryFilterText() {
  return state.dietaryFilters.length ? ` | Filters: ${state.dietaryFilters.join(', ')}` : '';
}

function renderRestaurantCard(restaurant) {
  const card = document.createElement('article');
  card.className = 'restaurant-card';

  const tagsHtml = Array.isArray(restaurant.dietaryTags)
  ? restaurant.dietaryTags
      .map((tag) => `<span class="metric-pill">${tag}</span>`)
      .join('')
  : '';

  if (state.selectedRestaurantId === restaurant.id) {
    card.classList.add('selected');
  }

  card.innerHTML = `
    ${
      restaurant.coverImage
        ? `<img src="${restaurant.coverImage}" alt="${restaurant.name}" loading="lazy" />`
        : ''
    }
    <div class="restaurant-card-body">
      <h3>${restaurant.name}</h3>
      <p class="muted">${restaurant.address}</p>
      <div class="metrics">
        <span class="metric-pill">${restaurant.distanceKm.toFixed(2)} km away</span>
        ${tagsHtml}
        <span class="metric-pill">Combined: ${ratingText(
          restaurant.combinedRating,
          restaurant.combinedRatingCount
        )}</span>
        <span class="metric-pill">Google: ${ratingText(
          restaurant.googleRating,
          restaurant.googleRatingCount
        )}</span>
        <span class="metric-pill">App: ${ratingText(
          restaurant.appRating,
          restaurant.appRatingCount
        )}</span>
      </div>
    </div>
  `;

  card.addEventListener('click', () => {
    state.selectedRestaurantId = restaurant.id;
    renderRestaurantList();

    if (restaurant.externalSource === 'openstreetmap') {
      renderExternalRestaurantDetails(restaurant);
      return;
    }

    if (restaurant.id >= 9001) {
      renderDemoRestaurantDetails(restaurant);
      return;
    }

    loadRestaurantDetails(restaurant.id).catch((err) => showToast(err.message, true));
  });

  return card;
}

function getFilteredRestaurants() {
  const selectedFilters = els.dietaryFilterInputs
    .filter((input) => input.checked)
    .map((input) => input.value.toLowerCase());

  if (selectedFilters.length === 0) {
    return state.restaurants;
  }

  return state.restaurants.filter((restaurant) =>
    Array.isArray(restaurant.dietaryTags) &&
    selectedFilters.some((selectedTag) =>
      restaurant.dietaryTags.some(
        (tag) => String(tag).toLowerCase() === selectedTag
      )
    )
  );
}

function renderRestaurantList() {
  els.list.innerHTML = '';

  if (!state.location) {
    els.list.innerHTML = '<p class="muted">Allow location or search one to start discovering restaurants.</p>';
    return;
  }

  if (state.restaurants.length === 0 && !state.loading) {
    els.list.innerHTML = '<p class="muted">No restaurants found for this location.</p>';
    return;
  }

  const restaurantsToShow = getFilteredRestaurants();

  if (restaurantsToShow.length === 0) {
    els.list.innerHTML = '<p class="muted">No restaurants match this filter.</p>';
    return;
  }

  restaurantsToShow.forEach((restaurant) => {
    els.list.appendChild(renderRestaurantCard(restaurant));
  });
}

function renderFeedLoader() {
  if (state.loading) {
    els.listLoader.textContent = 'Loading more restaurants...';
    return;
  }

  if (!state.hasMore && state.restaurants.length > 0) {
    els.listLoader.textContent = 'No more restaurants to load.';
    return;
  }

  els.listLoader.textContent = '';
}

async function geocodeQuery(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');

  const response = await fetch(url.toString(), {
    headers: {
      'Accept-Language': 'en',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to lookup location');
  }

  const results = await response.json();
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error('Location not found');
  }

  const best = results[0];
  return {
    lat: Number(best.lat),
    lng: Number(best.lon),
    label: best.display_name,
  };
}

async function reverseGeocode(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;

  const res = await fetch(url);
  const data = await res.json();

  const address = data.address || {};

  return (
    address.city ||
    address.town ||
    address.village ||  
    address.state ||
    'Unknown Location'
  );
}

function updateSelectedLocationText() {
  els.selectedLocationText.textContent = state.locationLabel || 'None selected';
}

function openLocationModal() {
  els.locationModal.classList.remove('hidden');

  window.setTimeout(() => {
    initLocationMap();
  }, 0);
}

function closeLocationModal() {
  els.locationModal.classList.add('hidden');
}

function setPendingMapLocation(lat, lng, label = null) {
  state.pendingMapLocation = { lat, lng, label };

  if (!locationMarker) {
    locationMarker = L.marker([lat, lng], { draggable: true }).addTo(locationMap);

    locationMarker.on('dragend', async () => {
      const pos = locationMarker.getLatLng();
      state.pendingMapLocation = {
        lat: pos.lat,
        lng: pos.lng,
        label: state.pendingMapLocation?.label || 'Dropped pin location',
      };

      try {
        const readable = await reverseGeocode(pos.lat, pos.lng);
        state.pendingMapLocation.label = readable;
        els.mapSelectionStatus.textContent = `Selected: ${readable}`;
      } catch (_err) {
        els.mapSelectionStatus.textContent = `Selected pin at ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
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
    locationMap = L.map('location-map').setView([37.7749, -122.4194], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(locationMap);

    locationMap.on('click', async (event) => {
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

  if (state.location) {
    setPendingMapLocation(state.location.lat, state.location.lng, state.locationLabel || 'Current selection');
  }
}

async function useBrowserLocationInModal() {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported in this browser', true);
    return;
  }

  els.mapSelectionStatus.textContent = 'Getting your location...';

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      try {
        const readable = await reverseGeocode(lat, lng);
        setPendingMapLocation(lat, lng, readable);
        state.pendingMapLocation.label = readable;
      } catch (_err) {
        setPendingMapLocation(lat, lng, 'Your current location');
      }
    },
    (error) => {
      showToast(error.message || 'Unable to retrieve your location', true);
      els.mapSelectionStatus.textContent =
        'Location access denied. Search manually or click the map to place a pin.';
    }
  );
}

async function searchLocationInModal() {
  const query = String(els.modalLocationQuery.value || '').trim();

  if (!query) {
    showToast('Enter a city, address, or zip', true);
    return;
  }

  try {
    els.mapSelectionStatus.textContent = 'Searching location...';
    const location = await geocodeQuery(query);
    setPendingMapLocation(location.lat, location.lng, location.label);
    state.pendingMapLocation.label = location.label;
  } catch (err) {
    showToast(err.message, true);
    els.mapSelectionStatus.textContent = 'Search failed. Try another query.';
  }
}

async function confirmSelectedLocation() {
  if (!state.pendingMapLocation) {
    showToast('Choose a location on the map first', true);
    return;
  }

  state.location = {
    lat: state.pendingMapLocation.lat,
    lng: state.pendingMapLocation.lng,
  };

  state.locationLabel = state.pendingMapLocation.label || 'Selected area';
  els.locationStatus.textContent = `Showing restaurants near ${state.locationLabel}`;
  updateSelectedLocationText();
  closeLocationModal();

  try {
    await resetAndReloadRestaurants();
  } catch (err) {
    showToast(err.message, true);
  }
}

function setupInfiniteScroll() {
  if (observer) observer.disconnect();

  observer = new IntersectionObserver(
    (entries) => {
      const [entry] = entries;
      if (entry.isIntersecting) {
        loadMoreRestaurants().catch((err) => showToast(err.message, true));
      }
    },
    { rootMargin: '400px 0px 400px 0px' }
  );

  observer.observe(els.sentinel);
}

async function loadMoreRestaurants() {
  if (!state.location || state.loading || !state.hasMore) return;

  state.loading = true;
  renderFeedLoader();

  const params = new URLSearchParams({
    lat: String(state.location.lat),
    lng: String(state.location.lng),
    limit: '20',
  });

  if (state.dietaryFilters.length) {
    params.set('dietary', state.dietaryFilters.join(','));
  }

  if (state.cursor) {
    params.set('cursor', state.cursor);
  }

  try {
    const externalItems = await fetchExternalRestaurants(state.location.lat, state.location.lng);
    const filteredExternalItems = externalItems.filter((restaurant) =>
      state.dietaryFilters.every((tag) =>
        (restaurant.dietaryTags || []).map((item) => item.toLowerCase()).includes(String(tag).toLowerCase())
      )
    );

    if (filteredExternalItems.length > 0) {
      state.hasMore = false;
      state.cursor = null;
      state.restaurants = filteredExternalItems;
      els.feedMeta.textContent = `${filteredExternalItems.length} restaurants found near ${state.locationLabel || 'selected area'}${activeDietaryFilterText()}`;
      renderRestaurantList();
      return;
    }

    const data = await api(`/api/restaurants/nearby?${params.toString()}`);

    let items = data.items || [];

    if (items.length === 0 && state.restaurants.length === 0) {
      items = demoRestaurants
        .filter((restaurant) =>
          state.dietaryFilters.every((tag) => (restaurant.dietaryTags || []).includes(tag))
        )
        .map((restaurant, index) => ({
          ...restaurant,
          coverImage: restaurant.image,
          distanceKm: 0.8 + index * 0.6,
          combinedRating: restaurant.rating,
          combinedRatingCount: 24 + index * 7,
          googleRating: restaurant.rating,
          googleRatingCount: 18 + index * 5,
          appRating: restaurant.rating,
          appRatingCount: 10 + index * 3,
        }));

      state.hasMore = false;
      state.cursor = null;
      state.restaurants = items;
      els.feedMeta.textContent = `${items.length} demo restaurants near ${state.locationLabel || 'selected area'}${activeDietaryFilterText()}`;
      renderRestaurantList();
      return;
    }

    state.restaurants.push(...items);
    state.cursor = data.nextCursor || null;
    state.hasMore = Boolean(data.hasMore);
    els.feedMeta.textContent = `${data.total || state.restaurants.length} restaurants found near ${state.locationLabel || 'selected area'}${activeDietaryFilterText()}`;
    renderRestaurantList();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    renderFeedLoader();
  }
}

function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  return date.toLocaleDateString();
}

function renderReviewForm(detail, reviews) {
  if (!state.user) {
    return '<p class="muted">Sign up or log in to post a review.</p>';
  }

  if (state.user.role !== 'customer') {
    return '<p class="muted">Owner accounts cannot post customer reviews in this prototype.</p>';
  }

  const myReview = detail.myReview;
  const myReviewId = myReview
    ? myReview.id
    : (reviews.find((item) => item.userId === state.user.id) || {}).id || '';

  return `
    <form id="review-form" class="review-form">
      <h3>${myReview ? 'Update Your Review' : 'Write a Review'}</h3>
      <input name="rating" type="number" min="1" max="5" step="1" required value="${
        myReview ? myReview.rating : ''
      }" placeholder="Rating (1-5)" />
      <textarea name="comment" placeholder="Share your experience">${
        myReview && myReview.comment ? myReview.comment : ''
      }</textarea>
      <button class="btn btn-primary" type="submit">${myReview ? 'Save Review' : 'Post Review'}</button>
      ${myReview ? '<button class="btn btn-outline" type="button" id="delete-review">Delete Review</button>' : ''}
      <input type="hidden" name="reviewId" value="${myReviewId || ''}" />
    </form>
  `;
}

function renderDemoRestaurantDetails(restaurant) {
  els.detailsPanel.innerHTML = `
    <h2>${restaurant.name}</h2>
    <p class="muted">${restaurant.address}</p>
    <p>${restaurant.description}</p>

    <div class="metrics">
      ${
        restaurant.dietaryTags && restaurant.dietaryTags.length
          ? restaurant.dietaryTags.map((tag) => `<span class="metric-pill">${tag}</span>`).join('')
          : ''
      }
      <span class="metric-pill">Combined: ${restaurant.combinedRating.toFixed(1)} (${restaurant.combinedRatingCount})</span>
      <span class="metric-pill">Google: ${restaurant.googleRating.toFixed(1)} (${restaurant.googleRatingCount})</span>
      <span class="metric-pill">App: ${restaurant.appRating.toFixed(1)} (${restaurant.appRatingCount})</span>
    </div>

    <h3>Gallery</h3>
    <div class="detail-gallery">
      <img src="${restaurant.coverImage}" alt="${restaurant.name}" loading="lazy" />
    </div>

    <h3>Menu</h3>
    <div>
      <div class="menu-item">
        <strong>Chef Special Bowl</strong> - $14.99
        <p class="muted">A sample showcase item for this demo restaurant.</p>
      </div>
      <div class="menu-item">
        <strong>House Drink</strong> - $4.99
        <p class="muted">Refreshing beverage option.</p>
      </div>
    </div>

    <h3>Reviews</h3>
    <div>
      <article class="review-item">
        <strong>Demo User</strong> - 5/5
        <p>Great atmosphere and tasty food. This is a showcase review.</p>
        <p class="muted">Today</p>
      </article>
    </div>
  `;
}

function renderExternalRestaurantDetails(restaurant) {
  const cuisine = restaurant.cuisineTags.length
    ? restaurant.cuisineTags.map((tag) => `<span class="metric-pill">${tag}</span>`).join('')
    : '<span class="metric-pill">Cuisine unknown</span>';
  const dietary = restaurant.dietaryTags.length
    ? restaurant.dietaryTags.map((tag) => `<span class="metric-pill">${tag}</span>`).join('')
    : '';
  const websiteHtml = restaurant.website
    ? `<p><a href="${restaurant.website}" target="_blank" rel="noreferrer">Website</a></p>`
    : '';
  const phoneHtml = restaurant.phone ? `<p><strong>Phone:</strong> ${restaurant.phone}</p>` : '';
  const openingHoursHtml = restaurant.openingHours
    ? `<p><strong>Hours:</strong> ${restaurant.openingHours}</p>`
    : '';

  els.detailsPanel.innerHTML = `
    <h2>${restaurant.name}</h2>
    <p class="muted">${restaurant.address}</p>
    <p>${restaurant.description}</p>

    <div class="metrics">
      <span class="metric-pill">${restaurant.distanceKm.toFixed(2)} km away</span>
      <span class="metric-pill">OpenStreetMap</span>
      ${cuisine}
      ${dietary}
    </div>

    <h3>Information</h3>
    <div>
      ${phoneHtml}
      ${websiteHtml}
      ${openingHoursHtml}
      <p class="muted">Photos, menus, and reviews are only available for restaurants stored in Nearby Bites.</p>
    </div>
  `;
}

async function loadRestaurantDetails(restaurantId) {
  const [detail, reviewsData] = await Promise.all([
    api(`/api/restaurants/${restaurantId}`),
    api(`/api/restaurants/${restaurantId}/reviews`),
  ]);

  const restaurant = detail.restaurant;
  const images = detail.images || [];
  const menuItems = detail.menuItems || [];
  const reviews = reviewsData.reviews || [];

  els.detailsPanel.innerHTML = `
    <h2>${restaurant.name}</h2>
    <p class="muted">${restaurant.address}</p>
    <p>${restaurant.description || 'No description provided yet.'}</p>

    <div class="metrics">
      ${
        restaurant.dietaryTags && restaurant.dietaryTags.length
          ? restaurant.dietaryTags.map((tag) => `<span class="metric-pill">${tag}</span>`).join('')
          : ''
      }
      <span class="metric-pill">Combined: ${ratingText(
        restaurant.combinedRating,
        restaurant.combinedRatingCount
      )}</span>
      <span class="metric-pill">Google: ${ratingText(
        restaurant.googleRating,
        restaurant.googleRatingCount
      )}</span>
      <span class="metric-pill">App: ${ratingText(restaurant.appRating, restaurant.appRatingCount)}</span>
    </div>

    <h3>Gallery</h3>
    <div class="detail-gallery">
      ${
        images.length
          ? images.map((img) => `<img src="${img.url}" alt="${restaurant.name}" loading="lazy" />`).join('')
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
                <p class="muted">${item.description || ''}</p>
              </div>
            `
              )
              .join('')
          : '<p class="muted">No menu items yet.</p>'
      }
    </div>

    ${renderReviewForm(detail, reviews)}

    <h3>Reviews</h3>
    <div>
      ${
        reviews.length
          ? reviews
              .map(
                (review) => `
              <article class="review-item">
                <strong>${review.userName}</strong> - ${review.rating}/5
                <p>${review.comment || ''}</p>
                <p class="muted">${formatDate(review.createdAt)}</p>
              </article>
            `
              )
              .join('')
          : '<p class="muted">No reviews yet.</p>'
      }
    </div>
  `;

  const reviewForm = document.getElementById('review-form');
  if (reviewForm) {
    reviewForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const formData = new FormData(reviewForm);
      try {
        await api(`/api/restaurants/${restaurantId}/reviews`, {
          method: 'POST',
          body: {
            rating: Number(formData.get('rating')),
            comment: String(formData.get('comment') || '').trim(),
          },
        });

        showToast('Review saved');
        await Promise.all([loadRestaurantDetails(restaurantId), refreshRestaurantInFeed(restaurantId)]);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }

  const deleteBtn = document.getElementById('delete-review');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async () => {
      const myReview = detail.myReview;
      if (!myReview) return;

      try {
        await api(`/api/restaurants/${restaurantId}/reviews/${myReview.id}`, {
          method: 'DELETE',
        });
        showToast('Review deleted');
        await Promise.all([loadRestaurantDetails(restaurantId), refreshRestaurantInFeed(restaurantId)]);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }
}

async function refreshRestaurantInFeed(restaurantId) {
  if (typeof restaurantId !== 'number') {
    return;
  }

  const detail = await api(`/api/restaurants/${restaurantId}`);
  const restaurant = detail.restaurant;
  const index = state.restaurants.findIndex((item) => item.id === restaurantId);
  if (index !== -1) {
    const current = state.restaurants[index];
    state.restaurants[index] = {
      ...current,
      ...restaurant,
      distanceKm: current.distanceKm,
    };
    renderRestaurantList();
  }
}

async function loadOwnerRestaurants() {
  const data = await api('/api/owner/restaurants');
  state.ownerRestaurants = data.restaurants;

  els.ownerRestaurantsList.innerHTML = state.ownerRestaurants.length
    ? state.ownerRestaurants
        .map(
          (restaurant) => `
          <div class="owner-row" data-restaurant-id="${restaurant.id}">
            <strong>${restaurant.name}</strong>
            <p class="muted">${restaurant.address}</p>
            <p class="muted">${restaurant.imageCount} images, ${restaurant.menuItemCount} menu items</p>
          </div>
        `
        )
        .join('')
    : '<p class="muted">No restaurants yet.</p>';

  const options = state.ownerRestaurants
    .map((restaurant) => `<option value="${restaurant.id}">${restaurant.name}</option>`)
    .join('');

  const placeholder = '<option value="">Select restaurant</option>';
  els.editRestaurantSelect.innerHTML = placeholder + options;
  els.imageRestaurantSelect.innerHTML = placeholder + options;
  els.menuRestaurantSelect.innerHTML = placeholder + options;

  const selectedId =
    state.selectedOwnerRestaurantId && state.ownerRestaurants.some((item) => item.id === state.selectedOwnerRestaurantId)
      ? state.selectedOwnerRestaurantId
      : state.ownerRestaurants[0] && state.ownerRestaurants[0].id;

  if (selectedId) {
    populateOwnerRestaurantForm(selectedId);
  } else if (els.editRestaurantForm) {
    els.editRestaurantForm.reset();
  }

  els.ownerRestaurantsList.querySelectorAll('[data-restaurant-id]').forEach((row) => {
    row.addEventListener('click', () => {
      populateOwnerRestaurantForm(Number(row.dataset.restaurantId));
    });
  });
}

function toCuisineTagString(cuisineTags) {
  return Array.isArray(cuisineTags) ? cuisineTags.join(', ') : '';
}

function populateOwnerRestaurantForm(restaurantId) {
  const restaurant = state.ownerRestaurants.find((item) => item.id === Number(restaurantId));
  if (!restaurant || !els.editRestaurantForm) return;

  state.selectedOwnerRestaurantId = restaurant.id;
  els.editRestaurantSelect.value = String(restaurant.id);
  els.editRestaurantForm.elements.restaurantId.value = String(restaurant.id);
  els.editRestaurantForm.elements.name.value = restaurant.name || '';
  els.editRestaurantForm.elements.address.value = restaurant.address || '';
  els.editRestaurantForm.elements.lat.value = restaurant.lat ?? '';
  els.editRestaurantForm.elements.lng.value = restaurant.lng ?? '';
  els.editRestaurantForm.elements.phone.value = restaurant.phone || '';
  els.editRestaurantForm.elements.website.value = restaurant.website || '';
  els.editRestaurantForm.elements.cuisineTags.value = toCuisineTagString(restaurant.cuisineTags);
  els.editRestaurantForm.elements.dietaryTags.value = toCuisineTagString(restaurant.dietaryTags);
  els.editRestaurantForm.elements.description.value = restaurant.description || '';
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark', isDark);

  if (els.themeToggleBtn) {
    els.themeToggleBtn.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
  }

  localStorage.setItem('theme', theme);
}

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    applyTheme(savedTheme);
    return;
  }

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(prefersDark ? 'dark' : 'light');
}

function bindEvents() {
  els.openAuthBtn.addEventListener('click', () => {
    navigateToAuthPage();
  });

  els.openLocationModalBtn.addEventListener('click', () => {
    openLocationModal();
  });

  els.closeLocationModalBtn.addEventListener('click', () => {
    closeLocationModal();
  });

  els.locationModal.addEventListener('click', (event) => {
    if (event.target === els.locationModal) {
      closeLocationModal();
    }
  });

  els.useBrowserLocationBtn.addEventListener('click', async () => {
    await useBrowserLocationInModal();
  });

  els.modalSearchLocationBtn.addEventListener('click', async () => {
    await searchLocationInModal();
  });

  els.modalLocationQuery.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      await searchLocationInModal();
    }
  });

  els.confirmLocationBtn.addEventListener('click', async () => {
    await confirmSelectedLocation();
  });

  if (els.dietaryFilterInputs.length) {
    els.dietaryFilterInputs.forEach((input) => {
      input.addEventListener('change', async () => {
        state.dietaryFilters = els.dietaryFilterInputs
          .filter((item) => item.checked)
          .map((item) => item.value);

        if (state.location) {
          await resetAndReloadRestaurants();
        } else {
          renderRestaurantList();
        }
      });
    });
  }

  if (els.clearFiltersBtn) {
    els.clearFiltersBtn.addEventListener('click', async () => {
      els.dietaryFilterInputs.forEach((input) => {
        input.checked = false;
      });

      state.dietaryFilters = [];

      if (state.location) {
        await resetAndReloadRestaurants();
      } else {
        renderRestaurantList();
      }
    });
  }

  document.addEventListener('click', (event) => {
    if (els.dietaryDropdown && !els.dietaryDropdown.contains(event.target)) {
      els.dietaryDropdownMenu.classList.add('hidden');
    }
  });

  els.themeToggleBtn.addEventListener('click', () => {
    const isDark = document.body.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
  });

  els.logoutBtn.addEventListener('click', async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: {} });
    } catch (_err) {
      // Ignore logout errors for stateless token flow.
    }

    clearAuth();
    renderAuthUI();
    showToast('Logged out');

    if (state.selectedRestaurantId) {
      loadRestaurantDetails(state.selectedRestaurantId).catch((err) => showToast(err.message, true));
    }
  });

  if (els.useLocationBtn) {
    els.useLocationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Geolocation is not supported in this browser', true);
      return;
    }

    els.locationStatus.textContent = 'Getting your location...';
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        state.location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        
        reverseGeocode(position.coords.latitude, position.coords.longitude)
          .then((city) => {
            state.locationLabel = city;
            els.locationStatus.textContent = `Showing restaurants near ${city}`;
          })
          .catch(() => {
            state.locationLabel = 'Your current location';
            els.locationStatus.textContent = 'Using your current location';
          });

        try {
          await resetAndReloadRestaurants();
        } catch (err) {
          showToast(err.message, true);
        }
      },
      (error) => {
        showToast(error.message || 'Unable to retrieve your location', true);
        els.locationStatus.textContent =
          'Location access denied. You can still search by city/address/zip.';
      }
    );
    });
  }

  if (els.searchLocationBtn) {
    els.searchLocationBtn.addEventListener('click', async () => {
      const query = String(els.locationQuery.value || '').trim();
      if (!query) {
        showToast('Enter a city, address, or zip', true);
        return;
      }

      try {
        els.locationStatus.textContent = 'Searching location...';
        const location = await geocodeQuery(query);
        state.location = { lat: location.lat, lng: location.lng };
        state.locationLabel = query;
        els.locationStatus.textContent = `Using ${location.label}`;
        await resetAndReloadRestaurants();
      } catch (err) {
        showToast(err.message, true);
        els.locationStatus.textContent = 'Search failed. Try another query.';
      }
    });
  }

  els.createRestaurantForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.user || state.user.role !== 'owner') {
      showToast('Owner login required', true);
      return;
    }

    const formData = new FormData(els.createRestaurantForm);
    let lat = formData.get('lat');
    let lng = formData.get('lng');
    const address = String(formData.get('address') || '').trim();

    try {
      if ((!lat || !lng) && address) {
        const geo = await geocodeQuery(address);
        lat = geo.lat;
        lng = geo.lng;
      }

      await api('/api/owner/restaurants', {
        method: 'POST',
        body: {
          name: String(formData.get('name') || '').trim(),
          address,
          lat: Number(lat),
          lng: Number(lng),
          phone: String(formData.get('phone') || '').trim(),
          website: String(formData.get('website') || '').trim(),
          description: String(formData.get('description') || '').trim(),
          cuisineTags: String(formData.get('cuisineTags') || '').trim(),
          dietaryTags: String(formData.get('dietaryTags') || '').trim(),
        },
      });

      els.createRestaurantForm.reset();
      await loadOwnerRestaurants();
      showToast('Restaurant created');

      if (state.location) {
        await resetAndReloadRestaurants();
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  els.uploadImagesForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.user || state.user.role !== 'owner') {
      showToast('Owner login required', true);
      return;
    }

    const formData = new FormData(els.uploadImagesForm);
    const restaurantId = String(formData.get('restaurantId') || '');
    if (!restaurantId) {
      showToast('Choose a restaurant', true);
      return;
    }

    try {
      const payload = new FormData();
      const files = els.uploadImagesForm.querySelector('input[name="images"]').files;
      for (const file of files) {
        payload.append('images', file);
      }

      await api(`/api/owner/restaurants/${restaurantId}/images`, {
        method: 'POST',
        body: payload,
      });

      els.uploadImagesForm.reset();
      showToast('Images uploaded');
      await loadOwnerRestaurants();

      if (state.selectedRestaurantId === Number(restaurantId)) {
        await loadRestaurantDetails(Number(restaurantId));
        await refreshRestaurantInFeed(Number(restaurantId));
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  els.menuItemForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.user || state.user.role !== 'owner') {
      showToast('Owner login required', true);
      return;
    }

    const formData = new FormData(els.menuItemForm);
    const restaurantId = String(formData.get('restaurantId') || '');
    if (!restaurantId) {
      showToast('Choose a restaurant', true);
      return;
    }

    try {
      const payload = new FormData();
      payload.append('name', String(formData.get('name') || '').trim());
      payload.append('description', String(formData.get('description') || '').trim());
      payload.append('price', String(formData.get('price') || '0'));

      const fileInput = els.menuItemForm.querySelector('input[name="image"]');
      if (fileInput.files[0]) {
        payload.append('image', fileInput.files[0]);
      }

      await api(`/api/owner/restaurants/${restaurantId}/menu-items`, {
        method: 'POST',
        body: payload,
      });

      els.menuItemForm.reset();
      showToast('Menu item added');
      await loadOwnerRestaurants();

      if (state.selectedRestaurantId === Number(restaurantId)) {
        await loadRestaurantDetails(Number(restaurantId));
      }
    } catch (err) {
      showToast(err.message, true);
    }
  });

  if (els.editRestaurantSelect) {
    els.editRestaurantSelect.addEventListener('change', (event) => {
      const restaurantId = Number(event.target.value);
      if (restaurantId) {
        populateOwnerRestaurantForm(restaurantId);
      }
    });
  }

  if (els.editRestaurantForm) {
    els.editRestaurantForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!state.user || state.user.role !== 'owner') {
        showToast('Owner login required', true);
        return;
      }

      const formData = new FormData(els.editRestaurantForm);
      const restaurantId = Number(formData.get('restaurantId'));
      if (!restaurantId) {
        showToast('Choose a restaurant', true);
        return;
      }

      try {
        await api(`/api/owner/restaurants/${restaurantId}`, {
          method: 'PUT',
          body: {
            name: String(formData.get('name') || '').trim(),
            address: String(formData.get('address') || '').trim(),
            lat: Number(formData.get('lat')),
            lng: Number(formData.get('lng')),
            phone: String(formData.get('phone') || '').trim(),
            website: String(formData.get('website') || '').trim(),
            description: String(formData.get('description') || '').trim(),
            cuisineTags: String(formData.get('cuisineTags') || '').trim(),
            dietaryTags: String(formData.get('dietaryTags') || '').trim(),
          },
        });

        await loadOwnerRestaurants();

        if (state.location) {
          await resetAndReloadRestaurants();
        }

        if (state.selectedRestaurantId === restaurantId) {
          await loadRestaurantDetails(restaurantId);
        }

        showToast('Restaurant updated');
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }
}

async function resetAndReloadRestaurants() {
  state.restaurants = [];
  state.cursor = null;
  state.hasMore = true;
  state.selectedRestaurantId = null;
  els.detailsPanel.innerHTML =
    '<h2>Restaurant Details</h2><p class="muted">Select a restaurant to view menu, photos, and reviews.</p>';
  renderRestaurantList();
  await loadMoreRestaurants();
}

async function init() {
  initTheme();
  renderAuthUI();
  bindEvents();
  setupInfiniteScroll();
  updateSelectedLocationText();
  renderRestaurantList();
  renderFeedLoader();
  // bindEvents();
  // setupInfiniteScroll();

  state.location = { lat: 37.7937, lng: -122.395 };
  state.locationLabel = 'San Francisco (default)';
  els.locationStatus.textContent = 'Using default location (San Francisco). You can change this anytime.';

  try {
    await resetAndReloadRestaurants();
  } catch (err) {
    showToast(err.message, true);
  }
}

init();
