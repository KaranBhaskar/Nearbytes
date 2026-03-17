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
  dietaryFilter: 'all',
}; 

const demoRestaurants = [
  {
    id: 9001,
    name: "Green Garden Bistro",
    address: "123 Market St, San Francisco",
    description: "Fresh vegetarian meals made with local ingredients.",
    rating: 4.6,
    cuisineTags: ["Vegetarian", "Healthy", "Kosher"],
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
    image:
      "https://images.unsplash.com/photo-1600891964599-f61ba0e24092"
  }
];

const els = {
  userPill: document.getElementById('user-pill'),
  openAuthBtn: document.getElementById('open-auth'),
  logoutBtn: document.getElementById('logout-btn'),
  themeToggleBtn: document.getElementById('theme-toggle'),
  useLocationBtn: document.getElementById('use-location'),
  searchLocationBtn: document.getElementById('search-location'),
  locationQuery: document.getElementById('location-query'),
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
  uploadImagesForm: document.getElementById('upload-images-form'),
  menuItemForm: document.getElementById('menu-item-form'),
  imageRestaurantSelect: document.getElementById('image-restaurant-select'),
  menuRestaurantSelect: document.getElementById('menu-restaurant-select'),
  dietaryFilter: document.getElementById('dietary-filter'),
};

let observer;

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

function renderRestaurantCard(restaurant) {
  const card = document.createElement('article');
  card.className = 'restaurant-card';
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
    </div>
  `;

  card.addEventListener('click', () => {
  state.selectedRestaurantId = restaurant.id;
  renderRestaurantList();

  if (restaurant.id >= 9001) {
    renderDemoRestaurantDetails(restaurant);
    return;
  }

  loadRestaurantDetails(restaurant.id).catch((err) => showToast(err.message, true));
  });

  return card;
}

function getFilteredRestaurants() {
  if (!state.dietaryFilter || state.dietaryFilter === 'all') {
    return state.restaurants;
  }

  return state.restaurants.filter((restaurant) =>
    Array.isArray(restaurant.cuisineTags) &&
    restaurant.cuisineTags.some(
      (tag) => String(tag).toLowerCase() === state.dietaryFilter.toLowerCase()
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
    "Unknown Location"
  );
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

  if (state.cursor) {
    params.set('cursor', state.cursor);
  }

    try {
    if (state.restaurants.length === 0) {
      const items = demoRestaurants.map((restaurant, index) => ({
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
      els.feedMeta.textContent = `${items.length} demo restaurants near ${state.locationLabel || 'selected area'}`;
      renderRestaurantList();
      return;
    }

    const data = await api(`/api/restaurants/nearby?${params.toString()}`);
    const items = data.items || [];

    state.restaurants.push(...items);
    state.cursor = data.nextCursor || null;
    state.hasMore = Boolean(data.hasMore);
    els.feedMeta.textContent = `${data.total || state.restaurants.length} restaurants found near ${state.locationLabel || 'selected area'}`;
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
          <div class="owner-row">
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
  els.imageRestaurantSelect.innerHTML = placeholder + options;
  els.menuRestaurantSelect.innerHTML = placeholder + options;
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
  if (els.dietaryFilter) {
    els.dietaryFilter.addEventListener('change', () => {
      state.dietaryFilter = els.dietaryFilter.value;
      renderRestaurantList();
    });
  }
  els.openAuthBtn.addEventListener('click', () => {
    navigateToAuthPage();
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
  renderRestaurantList();
  renderFeedLoader();
  bindEvents();
  setupInfiniteScroll();

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
