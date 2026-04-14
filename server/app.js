require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { getDb } = require("./db");
const {
  generateToken,
  sanitizeUser,
  optionalAuth,
  requireAuth,
  requireRole,
} = require("./auth");
const {
  haversineKm,
  encodeCursor,
  decodeCursor,
  combineRatings,
} = require("./utils");

const app = express();
const db = getDb();
const APP_USER_AGENT = "NearbyBites/1.0 (restaurant-discovery-app)";
const MODERATOR_EMAIL = "nearbytesadmin@email.com";
const MODERATOR_PASSWORD = "nearbytesadmin";

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const OVERPASS_REQUEST_TIMEOUT_MS = 8000;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.ru/api/interpreter",
];

// ─── Fallback tag pool for restaurants with no tags ──────────────────────────
const FALLBACK_TAG_POOL = [
  "Casual Dining",
  "Family Style",
  "Quick Bites",
  "Comfort Food",
  "International",
  "Local Favorite",
  "Grill",
  "Seafood",
  "Bakery & Café",
  "Street Food",
  "Bistro",
  "Fusion",
  "Farm to Table",
  "Brunch Spot",
  "Takeout Friendly",
];

/**
 * Generate a stable deterministic hash number from a string (restaurant name)
 * so tags don't change on every reload.
 */
function stableHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash >>> 0; // keep 32-bit unsigned
  }
  return hash;
}

/**
 * Return 2 stable fallback cuisine tags for a restaurant name.
 */
function generateFallbackTags(name) {
  const hash = stableHash(String(name || "restaurant"));
  const idx1 = hash % FALLBACK_TAG_POOL.length;
  const idx2 = (hash * 7 + 3) % FALLBACK_TAG_POOL.length;
  const tag1 = FALLBACK_TAG_POOL[idx1];
  const tag2 =
    FALLBACK_TAG_POOL[
      idx2 === idx1 ? (idx2 + 1) % FALLBACK_TAG_POOL.length : idx2
    ];
  return [tag1, tag2];
}

function ensureAtLeastTwoTags(tags = [], seed = "restaurant") {
  const unique = Array.from(
    new Set(
      (tags || []).map((tag) => String(tag || "").trim()).filter(Boolean),
    ),
  );
  if (unique.length >= 2) {
    return unique;
  }

  if (unique.length === 1) {
    const hash = stableHash(String(seed || unique[0]));
    let fallback = FALLBACK_TAG_POOL[hash % FALLBACK_TAG_POOL.length];
    if (String(fallback).toLowerCase() === String(unique[0]).toLowerCase()) {
      fallback = FALLBACK_TAG_POOL[(hash + 1) % FALLBACK_TAG_POOL.length];
    }
    return [unique[0], fallback];
  }

  return generateFallbackTags(seed);
}

function ensureModeratorAccount() {
  const normalizedEmail = MODERATOR_EMAIL.toLowerCase();
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(normalizedEmail);
  const passwordHash = bcrypt.hashSync(MODERATOR_PASSWORD, 10);

  if (existing) {
    db.prepare(
      `UPDATE users
       SET name = ?, password_hash = ?, role = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run("Nearbytes Moderator", passwordHash, "moderator", existing.id);
    return;
  }

  db.prepare(
    "INSERT INTO users(name, email, password_hash, role) VALUES (?, ?, ?, ?)",
  ).run("Nearbytes Moderator", normalizedEmail, passwordHash, "moderator");
}

ensureModeratorAccount();

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image uploads are allowed"));
    }
    return cb(null, true);
  },
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(process.cwd(), "public")));

// ─── Runtime config (injected into the browser) ──────────────────────────────
app.get("/runtime-config.js", (_req, res) => {
  const config = {
    convexUrl: "",
    appMode: "local",
    clientOrigin:
      process.env.CLIENT_ORIGIN ||
      `http://localhost:${process.env.PORT || 3000}`,
    nearbyRadiusMeters: Number(process.env.OSM_NEARBY_RADIUS_METERS || 5000),
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    hasGemini: Boolean(GEMINI_API_KEY),
  };

  res.set("Content-Type", "application/javascript; charset=utf-8");
  res.set("Cache-Control", "no-store");
  res.send(
    `window.__APP_CONFIG__ = Object.freeze(${JSON.stringify(config, null, 2)});\n`,
  );
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseCuisineTags(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return String(value)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
}

function normalizeTagList(value) {
  if (Array.isArray(value))
    return value.map((t) => String(t).trim()).filter(Boolean);
  return String(value || "")
    .split(/[;,]/)
    .map((t) => String(t).trim())
    .filter(Boolean);
}

function safeHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:" || parsed.protocol === "https:")
      return parsed.toString();
  } catch (_err) {
    return null;
  }
  return null;
}

function hasTruthyDietaryValue(value) {
  return ["yes", "only", "limited", "true", "1"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function inferExternalDietaryTags(tags = {}) {
  const dietaryTags = new Set();
  const searchableText = Object.values(tags)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const cuisineText = String(tags.cuisine || "").toLowerCase();
  const nameText = String(tags.name || "").toLowerCase();
  const combinedText = `${nameText} ${cuisineText} ${searchableText}`;

  if (
    hasTruthyDietaryValue(tags["diet:vegan"]) ||
    combinedText.includes("vegan")
  )
    dietaryTags.add("vegan");
  if (
    hasTruthyDietaryValue(tags["diet:vegetarian"]) ||
    combinedText.includes("vegetarian")
  )
    dietaryTags.add("vegetarian");
  if (
    hasTruthyDietaryValue(tags["diet:halal"]) ||
    combinedText.includes("halal")
  )
    dietaryTags.add("halal");
  if (
    hasTruthyDietaryValue(tags["diet:kosher"]) ||
    combinedText.includes("kosher")
  )
    dietaryTags.add("kosher");
  if (
    hasTruthyDietaryValue(tags["diet:gluten_free"]) ||
    hasTruthyDietaryValue(tags["diet:gluten-free"]) ||
    combinedText.includes("gluten free") ||
    combinedText.includes("gluten-free")
  )
    dietaryTags.add("gluten-free");

  if (
    combinedText.includes("salad") ||
    combinedText.includes("veggie") ||
    combinedText.includes("plant-based")
  )
    dietaryTags.add("vegetarian");
  if (
    combinedText.includes("indian") ||
    combinedText.includes("mediterranean") ||
    combinedText.includes("middle eastern") ||
    combinedText.includes("falafel")
  )
    dietaryTags.add("vegetarian");
  if (
    combinedText.includes("shawarma") ||
    combinedText.includes("kebab") ||
    combinedText.includes("gyro") ||
    combinedText.includes("halal")
  )
    dietaryTags.add("halal");
  if (dietaryTags.has("vegan")) dietaryTags.add("vegetarian");

  return Array.from(dietaryTags);
}

function buildExternalAddress(tags = {}) {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:city"] || tags["addr:town"] || tags["addr:village"],
    tags["addr:state"],
    tags["addr:postcode"],
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+,/g, ",")
    .trim();
  return parts || tags["addr:full"] || "Address not available";
}

function normalizeExternalRestaurantElement(element, originLat, originLng) {
  const tags = element.tags || {};
  const lat = Number(element.lat ?? element.center?.lat);
  const lng = Number(element.lon ?? element.center?.lon);
  const name = String(tags.name || "").trim();
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let inferredDietaryTags = inferExternalDietaryTags(tags);
  const lowerName = name.toLowerCase();
  if (lowerName.includes("subway"))
    inferredDietaryTags = [...new Set([...inferredDietaryTags, "vegetarian"])];
  if (lowerName.includes("osmow") || lowerName.includes("shawarma"))
    inferredDietaryTags = [...new Set([...inferredDietaryTags, "halal"])];

  let cuisineTags = ensureAtLeastTwoTags(normalizeTagList(tags.cuisine), name);

  return {
    externalPlaceId: `osm:${element.type}:${element.id}`,
    name,
    address: buildExternalAddress(tags),
    lat,
    lng,
    description: tags.description || null,
    phone: tags.phone || tags["contact:phone"] || null,
    website: tags.website || tags["contact:website"] || null,
    openingHours: tags.opening_hours || null,
    cuisineTags,
    dietaryTags: inferredDietaryTags,
    distanceKm: haversineKm(originLat, originLng, lat, lng),
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "User-Agent": APP_USER_AGENT,
      "Accept-Language": "en",
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    throw new Error(`External lookup failed with status ${response.status}`);
  }
  return response.json();
}

// ─── Google Places Nearby Search ──────────────────────────────────────────────
async function fetchGooglePlacesNearby(lat, lng, radiusMeters = 5000) {
  if (!GOOGLE_MAPS_API_KEY) {
    return null; // Signal to fall back to OSM
  }

  try {
    const url = new URL("https://places.googleapis.com/v1/places:searchNearby");
    const body = {
      includedTypes: [
        "restaurant",
        "cafe",
        "fast_food_restaurant",
        "food_court",
      ],
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
      rankPreference: "DISTANCE",
    };

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.regularOpeningHours,places.websiteUri,places.internationalPhoneNumber,places.types,places.primaryTypeDisplayName",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(
        "Google Places API error:",
        response.status,
        errText.slice(0, 200),
      );
      return null;
    }

    const data = await response.json();
    return data.places || [];
  } catch (err) {
    console.warn("Google Places fetch failed:", err.message);
    return null;
  }
}

function normalizeGooglePlace(place, originLat, originLng) {
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  const name = place.displayName?.text || "";
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const types = (place.types || []).filter(
    (t) =>
      !["establishment", "point_of_interest", "food", "restaurant"].includes(t),
  );
  let cuisineTags = types
    .map((t) => t.replace(/_/g, " "))
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .filter((t) => t.length > 2)
    .slice(0, 4);

  cuisineTags = ensureAtLeastTwoTags(cuisineTags, name);

  return {
    externalPlaceId: `google:${place.id}`,
    name,
    address: place.formattedAddress || "Address not available",
    lat,
    lng,
    description: null,
    phone: place.internationalPhoneNumber || null,
    website: place.websiteUri || null,
    openingHours:
      place.regularOpeningHours?.weekdayDescriptions?.join("; ") || null,
    cuisineTags,
    dietaryTags: [],
    googleRating: place.rating || null,
    googleRatingCount: place.userRatingCount || 0,
    distanceKm: haversineKm(originLat, originLng, lat, lng),
  };
}

// ─── OpenStreetMap Nearby Search ──────────────────────────────────────────────
async function syncOpenStreetMapNearby(lat, lng) {
  const seen = new Set();
  const radiusSteps = [5000, 10000, 20000, 30000];
  let normalizedRestaurants = [];
  let lastError = null;

  for (const radiusMeters of radiusSteps) {
    const query = `
[out:json][timeout:25];
(
  node["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${radiusMeters},${lat},${lng});
  way["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${radiusMeters},${lat},${lng});
);
out center tags;
`;

    let data = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        data = await fetchJson(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(OVERPASS_REQUEST_TIMEOUT_MS),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: new URLSearchParams({ data: query }),
        });
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!data) {
      // If every Overpass endpoint failed for this radius, bail out fast.
      break;
    }

    normalizedRestaurants = (data.elements || [])
      .map((element) => normalizeExternalRestaurantElement(element, lat, lng))
      .filter(Boolean)
      .filter((restaurant) => {
        const key =
          restaurant.externalPlaceId ||
          `${restaurant.name.toLowerCase()}|${restaurant.address.toLowerCase()}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    if (normalizedRestaurants.length >= 12) break;
  }

  if (!normalizedRestaurants.length && lastError) {
    throw lastError;
  }

  return normalizedRestaurants
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, 60);
}

// ─── Unified nearby fetch (Google Places → OSM fallback) ─────────────────────
async function syncNearbyRestaurants(lat, lng) {
  // Try Google Places first if API key is set
  if (GOOGLE_MAPS_API_KEY) {
    const radiusMeters = Number(process.env.OSM_NEARBY_RADIUS_METERS || 5000);
    const googlePlaces = await fetchGooglePlacesNearby(lat, lng, radiusMeters);
    if (googlePlaces && googlePlaces.length > 0) {
      const normalized = googlePlaces
        .map((place) => normalizeGooglePlace(place, lat, lng))
        .filter(Boolean)
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 60);

      return normalized.map((restaurant) => {
        const restaurantId = upsertExternalRestaurant(restaurant);
        return { ...restaurant, id: restaurantId };
      });
    }
    console.warn(
      "Google Places returned no results, falling back to OpenStreetMap.",
    );
  }

  // Fall back to OpenStreetMap
  const osmRestaurants = await syncOpenStreetMapNearby(lat, lng);
  return osmRestaurants.map((restaurant) => {
    const restaurantId = upsertExternalRestaurant(restaurant);
    return { ...restaurant, id: restaurantId };
  });
}

function upsertExternalRestaurant(restaurant) {
  const existing = db
    .prepare("SELECT id FROM restaurants WHERE google_place_id = ?")
    .get(restaurant.externalPlaceId);

  if (existing) {
    db.prepare(
      `
      UPDATE restaurants
      SET name = ?, address = ?, lat = ?, lng = ?,
          description = COALESCE(?, description),
          phone = COALESCE(?, phone),
          website = COALESCE(?, website),
          opening_hours = COALESCE(?, opening_hours),
          cuisine_tags = ?,
          dietary_tags = ?,
          google_rating = COALESCE(?, google_rating),
          google_rating_count = COALESCE(?, google_rating_count),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    ).run(
      restaurant.name,
      restaurant.address,
      restaurant.lat,
      restaurant.lng,
      restaurant.description,
      restaurant.phone,
      restaurant.website,
      restaurant.openingHours,
      JSON.stringify(restaurant.cuisineTags),
      JSON.stringify(restaurant.dietaryTags),
      restaurant.googleRating || null,
      restaurant.googleRatingCount || null,
      existing.id,
    );
    return existing.id;
  }

  const info = db
    .prepare(
      `
    INSERT INTO restaurants(
      owner_id, name, address, lat, lng, description, phone, website, opening_hours,
      cuisine_tags, dietary_tags, google_place_id, google_rating, google_rating_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      null,
      restaurant.name,
      restaurant.address,
      restaurant.lat,
      restaurant.lng,
      restaurant.description,
      restaurant.phone,
      restaurant.website,
      restaurant.openingHours,
      JSON.stringify(restaurant.cuisineTags),
      JSON.stringify(restaurant.dietaryTags),
      restaurant.externalPlaceId,
      restaurant.googleRating || null,
      restaurant.googleRatingCount || 0,
    );

  return Number(info.lastInsertRowid);
}

function normalizeRestaurantRow(row) {
  const appAvg = row.app_avg == null ? null : Number(row.app_avg);
  const appCount = Number(row.app_count || 0);
  const googleAvg =
    row.google_rating == null ? null : Number(row.google_rating);
  const googleCount = Number(row.google_rating_count || 0);
  const { combinedAvg, combinedCount } = combineRatings(
    googleAvg,
    googleCount,
    appAvg,
    appCount,
  );

  let cuisineTags = parseCuisineTags(row.cuisine_tags);
  let dietaryTags = parseCuisineTags(row.dietary_tags);

  const isOsm =
    row.google_place_id && String(row.google_place_id).startsWith("osm:");
  if (isOsm) {
    cuisineTags = ensureAtLeastTwoTags(cuisineTags, row.name || "restaurant");
  }

  const isGoogle =
    row.google_place_id && String(row.google_place_id).startsWith("google:");

  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    description: row.description,
    phone: row.phone,
    website: row.website,
    openingHours: row.opening_hours || null,
    menuUrl: row.menu_url || null,
    cuisineTags,
    dietaryTags,
    googlePlaceId: row.google_place_id,
    googlePhotoRef: row.google_photo_ref || null,
    googleMapsUri: isOsm
      ? `https://www.openstreetmap.org/${String(row.google_place_id).split(":").slice(1).join("/")}`
      : isGoogle
        ? `https://maps.google.com/?q=${encodeURIComponent(row.name)}&query=${row.lat},${row.lng}`
        : null,
    coverImage: row.cover_image || null,
    googleRating: googleAvg,
    googleRatingCount: googleCount,
    appRating: appAvg,
    appRatingCount: appCount,
    combinedRating: combinedAvg,
    combinedRatingCount: combinedCount,
    source: isOsm
      ? "openstreetmap"
      : isGoogle
        ? "google"
        : row.owner_id
          ? "manual"
          : "seed",
    isHidden: Boolean(row.is_hidden),
    hiddenReason: row.hidden_reason || null,
    hiddenAt: row.hidden_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRestaurantWithAggregates(restaurantId) {
  const row = db
    .prepare(
      `
    SELECT
      r.*,
      img.url AS cover_image,
      app.avg_rating AS app_avg,
      app.review_count AS app_count
    FROM restaurants r
    LEFT JOIN (
      SELECT restaurant_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
      FROM reviews GROUP BY restaurant_id
    ) app ON app.restaurant_id = r.id
    LEFT JOIN restaurant_images img ON img.restaurant_id = r.id AND img.is_cover = 1
    WHERE r.id = ?
  `,
    )
    .get(restaurantId);

  return row ? normalizeRestaurantRow(row) : null;
}

function canManageRestaurant(user, restaurant) {
  return (
    user.role === "moderator" || Number(restaurant.owner_id) === Number(user.id)
  );
}

function parseRestaurantPayload(body, existing = null) {
  const rawName = body.name;
  const rawAddress = body.address;
  const rawDescription = body.description;
  const rawPhone = body.phone;
  const rawWebsite = body.website;
  const rawOpeningHours = body.openingHours;
  const rawMenuUrl = body.menuUrl;
  const rawLat = body.lat;
  const rawLng = body.lng;
  const rawCuisineTags = body.cuisineTags;
  const rawDietaryTags = body.dietaryTags;

  const nextName =
    rawName == null ? existing && existing.name : String(rawName).trim();
  const nextAddress =
    rawAddress == null
      ? existing && existing.address
      : String(rawAddress).trim();
  const nextLat = rawLat == null ? existing && existing.lat : Number(rawLat);
  const nextLng = rawLng == null ? existing && existing.lng : Number(rawLng);

  if (!nextName || !nextAddress || nextLat == null || nextLng == null) {
    return { error: "name, address, lat and lng are required" };
  }

  if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
    return { error: "lat and lng must be valid numbers" };
  }

  const tagsSource =
    rawCuisineTags == null && existing
      ? parseCuisineTags(existing.cuisine_tags)
      : rawCuisineTags;
  let cuisineTags = Array.isArray(tagsSource)
    ? tagsSource.map((t) => String(t).trim()).filter(Boolean)
    : String(tagsSource || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

  cuisineTags = ensureAtLeastTwoTags(cuisineTags, nextName);

  const dietarySource =
    rawDietaryTags == null && existing
      ? parseCuisineTags(existing.dietary_tags)
      : rawDietaryTags;
  const dietaryTags = Array.isArray(dietarySource)
    ? dietarySource.map((t) => String(t).trim().toLowerCase()).filter(Boolean)
    : String(dietarySource || "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

  return {
    values: {
      name: nextName,
      address: nextAddress,
      lat: nextLat,
      lng: nextLng,
      description:
        rawDescription == null
          ? existing
            ? existing.description
            : null
          : String(rawDescription).trim() || null,
      phone:
        rawPhone == null
          ? existing
            ? existing.phone
            : null
          : String(rawPhone).trim() || null,
      website:
        rawWebsite == null
          ? existing
            ? existing.website
            : null
          : String(rawWebsite).trim() || null,
      openingHours:
        rawOpeningHours == null
          ? existing
            ? existing.opening_hours
            : null
          : String(rawOpeningHours).trim() || null,
      menuUrl:
        rawMenuUrl == null
          ? existing
            ? existing.menu_url
            : null
          : safeHttpUrl(rawMenuUrl),
      cuisineTags,
      dietaryTags,
    },
  };
}

function updateRestaurantRecord(restaurantId, values) {
  db.prepare(
    `
    UPDATE restaurants
    SET name = ?, address = ?, lat = ?, lng = ?, description = ?, phone = ?, website = ?,
        opening_hours = ?, menu_url = ?, cuisine_tags = ?, dietary_tags = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  ).run(
    values.name,
    values.address,
    values.lat,
    values.lng,
    values.description,
    values.phone,
    values.website,
    values.openingHours,
    values.menuUrl,
    JSON.stringify(values.cuisineTags),
    JSON.stringify(values.dietaryTags),
    restaurantId,
  );
}

// ─── Gemini Tag Enrichment ────────────────────────────────────────────────────
async function enrichTagsWithGemini(restaurants) {
  if (!GEMINI_API_KEY || !restaurants.length) {
    // Return stable fallback tags
    return restaurants.map((r) => ({
      restaurantId: r.id,
      cuisineTags:
        r.cuisineTags && r.cuisineTags.length >= 2
          ? r.cuisineTags
          : generateFallbackTags(r.name),
      dietaryTags: r.dietaryTags || [],
    }));
  }

  try {
    const prompt = `For each restaurant below, return 2-4 cuisine tags and 0-2 dietary restriction tags (only if clearly applicable: vegan, vegetarian, halal, kosher, gluten-free).
Return ONLY valid JSON array of {id, cuisineTags, dietaryTags} with no extra text.

Restaurants:
${restaurants.map((r) => `- id:${r.id} name:"${r.name}" address:"${r.address}"`).join("\n")}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.warn("Gemini API error:", response.status, errText.slice(0, 200));
      throw new Error("Gemini error");
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON in Gemini response");

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.map((item) => ({
      restaurantId: String(item.id),
      cuisineTags: Array.isArray(item.cuisineTags)
        ? item.cuisineTags
        : generateFallbackTags(item.id),
      dietaryTags: Array.isArray(item.dietaryTags) ? item.dietaryTags : [],
    }));
  } catch (err) {
    console.warn("Gemini tag enrichment failed, using fallback:", err.message);
    return restaurants.map((r) => ({
      restaurantId: String(r.id),
      cuisineTags:
        r.cuisineTags && r.cuisineTags.length >= 2
          ? r.cuisineTags
          : generateFallbackTags(r.name),
      dietaryTags: r.dietaryTags || [],
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    mode: "local",
    googleMaps: Boolean(GOOGLE_MAPS_API_KEY),
    gemini: Boolean(GEMINI_API_KEY),
  });
});

// ─── Location ─────────────────────────────────────────────────────────────────
app.get("/api/location/search", async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (!query) return res.status(400).json({ error: "q is required" });

  // Try Google Geocoding API first if key is present
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("address", query);
      url.searchParams.set("key", GOOGLE_MAPS_API_KEY);

      const data = await fetchJson(url.toString());
      if (data.status === "OK" && data.results?.[0]) {
        const result = data.results[0];
        const loc = result.geometry.location;
        return res.json({
          lat: loc.lat,
          lng: loc.lng,
          label: result.formatted_address,
          shortLabel: result.address_components?.[0]?.short_name || null,
          boundingBox: null,
        });
      }
    } catch (_err) {
      // fall through to OSM
    }
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "1");

    const results = await fetchJson(url.toString());
    if (!Array.isArray(results) || results.length === 0) {
      return res.status(404).json({ error: "Location not found" });
    }

    const best = results[0];
    return res.json({
      lat: Number(best.lat),
      lng: Number(best.lon),
      label: best.display_name,
      boundingBox: Array.isArray(best.boundingbox)
        ? best.boundingbox.map(Number)
        : null,
    });
  } catch (err) {
    return res
      .status(502)
      .json({ error: err.message || "Failed to lookup location" });
  }
});

app.get("/api/location/reverse", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng are required numbers" });
  }

  // Try Google Reverse Geocoding first
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("latlng", `${lat},${lng}`);
      url.searchParams.set("key", GOOGLE_MAPS_API_KEY);

      const data = await fetchJson(url.toString());
      if (data.status === "OK" && data.results?.[0]) {
        const result = data.results[0];
        const cityComp = result.address_components?.find(
          (c) =>
            c.types.includes("locality") ||
            c.types.includes("postal_town") ||
            c.types.includes("administrative_area_level_2"),
        );
        return res.json({
          label: cityComp?.long_name || result.formatted_address,
          shortLabel: cityComp?.short_name || null,
        });
      }
    } catch (_err) {
      // fall through to OSM
    }
  }

  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    url.searchParams.set("format", "jsonv2");

    const data = await fetchJson(url.toString());
    const address = data.address || {};
    return res.json({
      label:
        address.city ||
        address.town ||
        address.village ||
        address.state ||
        data.display_name ||
        "Unknown Location",
    });
  } catch (err) {
    return res
      .status(502)
      .json({ error: err.message || "Failed to reverse geocode location" });
  }
});

app.get("/api/location/restaurants", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "lat and lng are required numbers" });
  }

  try {
    const items = (await syncNearbyRestaurants(lat, lng)).map((r) => ({
      id: r.id,
      ownerId: null,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      description: r.description,
      phone: r.phone,
      website: r.website,
      openingHours: r.openingHours,
      cuisineTags: r.cuisineTags || [],
      dietaryTags: r.dietaryTags || [],
      googlePlaceId: r.externalPlaceId,
      coverImage: null,
      googleRating: r.googleRating || null,
      googleRatingCount: r.googleRatingCount || 0,
      appRating: null,
      appRatingCount: 0,
      combinedRating: r.googleRating || null,
      combinedRatingCount: r.googleRatingCount || 0,
      createdAt: null,
      updatedAt: null,
      distanceKm: r.distanceKm,
      externalSource: r.externalPlaceId?.startsWith("google:")
        ? "google"
        : "openstreetmap",
    }));
    return res.json({ items });
  } catch (err) {
    return res
      .status(502)
      .json({ error: err.message || "Failed to load nearby restaurants" });
  }
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.post("/api/auth/signup", (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    return res
      .status(400)
      .json({ error: "name, email, password, and role are required" });
  }

  if (!["customer", "owner", "moderator"].includes(role)) {
    return res
      .status(400)
      .json({ error: "role must be customer, owner, or moderator" });
  }

  if (String(password).length < 8) {
    return res
      .status(400)
      .json({ error: "password must be at least 8 characters" });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(normalizedEmail);
  if (existing) return res.status(409).json({ error: "email already in use" });

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      "INSERT INTO users(name, email, password_hash, role) VALUES (?, ?, ?, ?)",
    )
    .run(String(name).trim(), normalizedEmail, passwordHash, role);

  const user = db
    .prepare(
      "SELECT id, name, email, role, is_banned, banned_at, banned_reason FROM users WHERE id = ?",
    )
    .get(info.lastInsertRowid);
  const token = generateToken(user);
  return res.status(201).json({ token, user: sanitizeUser(user) });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "email and password are required" });

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(normalizedEmail);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  if (user.is_banned) {
    return res.status(403).json({
      error: user.banned_reason || "This account has been suspended.",
    });
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) return res.status(401).json({ error: "Invalid credentials" });

  const token = generateToken(user);
  return res.json({ token, user: sanitizeUser(user) });
});

app.post("/api/auth/logout", (_req, res) => res.json({ ok: true }));

app.get("/api/auth/me", optionalAuth, (req, res) =>
  res.json({ user: req.user || null }),
);

// ─── Restaurants ──────────────────────────────────────────────────────────────
app.get("/api/restaurants/nearby", async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res
      .status(400)
      .json({ error: "lat and lng query params are required numbers" });
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const offset = decodeCursor(req.query.cursor);
  const radiusMeters = Math.min(
    Math.max(
      Number(req.query.radiusMeters) ||
        Number(process.env.OSM_NEARBY_RADIUS_METERS) ||
        5000,
      1000,
    ),
    30000,
  );
  const maxDistanceKm = radiusMeters / 1000;
  const dietaryFilters = String(req.query.dietary || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  try {
    await syncNearbyRestaurants(lat, lng);
  } catch (err) {
    console.warn("Nearby sync failed:", err.message);
  }

  const rows = db
    .prepare(
      `
    SELECT r.*, img.url AS cover_image,
           app.avg_rating AS app_avg, app.review_count AS app_count
    FROM restaurants r
    LEFT JOIN (
      SELECT restaurant_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
      FROM reviews GROUP BY restaurant_id
    ) app ON app.restaurant_id = r.id
    LEFT JOIN restaurant_images img ON img.restaurant_id = r.id AND img.is_cover = 1
    WHERE COALESCE(r.is_hidden, 0) = 0
    ORDER BY r.id ASC
  `,
    )
    .all();

  const hasExternalRows = rows.some((row) => {
    const placeId = String(row.google_place_id || "");
    return placeId.startsWith("osm:") || placeId.startsWith("google:");
  });

  const effectiveRows = hasExternalRows
    ? rows.filter(
        (row) => !String(row.google_place_id || "").startsWith("seed_place_"),
      )
    : rows;

  const withDistance = effectiveRows
    .map((row) => ({
      ...normalizeRestaurantRow(row),
      distanceKm: haversineKm(lat, lng, row.lat, row.lng),
    }))
    .filter(
      (restaurant) =>
        Number.isFinite(restaurant.distanceKm) &&
        restaurant.distanceKm <= maxDistanceKm,
    )
    .filter((r) =>
      dietaryFilters.every((tag) =>
        r.dietaryTags.map((t) => t.toLowerCase()).includes(tag),
      ),
    )
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const items = withDistance.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < withDistance.length;

  return res.json({
    items,
    hasMore,
    nextCursor: hasMore ? encodeCursor(nextOffset) : null,
    total: withDistance.length,
  });
});

app.get("/api/restaurants/:id", optionalAuth, (req, res) => {
  const restaurantId = Number(req.params.id);
  if (!Number.isFinite(restaurantId))
    return res.status(400).json({ error: "invalid restaurant id" });

  const restaurant = getRestaurantWithAggregates(restaurantId);
  if (!restaurant)
    return res.status(404).json({ error: "restaurant not found" });

  const images = db
    .prepare(
      "SELECT id, url, is_cover AS isCover, created_at AS createdAt FROM restaurant_images WHERE restaurant_id = ? ORDER BY is_cover DESC, id DESC",
    )
    .all(restaurantId);

  const menuItems = db
    .prepare(
      `
    SELECT id, name, description, price, image_url AS imageUrl, created_at AS createdAt, updated_at AS updatedAt
    FROM menu_items WHERE restaurant_id = ? ORDER BY id DESC
  `,
    )
    .all(restaurantId);

  const myReview = req.user
    ? db
        .prepare(
          `
        SELECT id, rating, comment, created_at AS createdAt, updated_at AS updatedAt
        FROM reviews WHERE restaurant_id = ? AND user_id = ?
      `,
        )
        .get(restaurantId, req.user.id) || null
    : null;

  return res.json({ restaurant, images, menuItems, myReview });
});

app.get("/api/restaurants/:id/reviews", (req, res) => {
  const restaurantId = Number(req.params.id);
  if (!Number.isFinite(restaurantId))
    return res.status(400).json({ error: "invalid restaurant id" });

  const reviews = db
    .prepare(
      `
    SELECT r.id, r.rating, r.comment, r.created_at AS createdAt, r.updated_at AS updatedAt,
           u.id AS userId, u.name AS userName
    FROM reviews r
    INNER JOIN users u ON u.id = r.user_id
    WHERE r.restaurant_id = ? ORDER BY r.created_at DESC
  `,
    )
    .all(restaurantId);

  return res.json({ reviews });
});

// ─── Gemini Tag Enrichment Endpoint ──────────────────────────────────────────
app.post("/api/restaurants/refine-tags", async (req, res) => {
  const { restaurantIds } = req.body;
  if (!Array.isArray(restaurantIds) || !restaurantIds.length) {
    return res.status(400).json({ error: "restaurantIds array is required" });
  }

  const restaurants = restaurantIds
    .map((id) =>
      db
        .prepare(
          "SELECT id, name, address, cuisine_tags, dietary_tags FROM restaurants WHERE id = ?",
        )
        .get(Number(id)),
    )
    .filter(Boolean)
    .map((r) => ({
      ...r,
      cuisineTags: parseCuisineTags(r.cuisine_tags),
      dietaryTags: parseCuisineTags(r.dietary_tags),
    }));

  const updates = await enrichTagsWithGemini(restaurants);

  // Persist the enriched tags
  const updateStmt = db.prepare(
    "UPDATE restaurants SET cuisine_tags = ?, dietary_tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  );
  for (const update of updates) {
    const id = Number(update.restaurantId);
    if (!Number.isFinite(id)) continue;
    updateStmt.run(
      JSON.stringify(update.cuisineTags),
      JSON.stringify(update.dietaryTags),
      id,
    );
  }

  return res.json({ updated: updates });
});

// ─── Reviews ──────────────────────────────────────────────────────────────────
app.post(
  "/api/restaurants/:id/reviews",
  requireAuth,
  requireRole("customer"),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    const rating = Number(req.body.rating);
    const comment =
      req.body.comment == null ? null : String(req.body.comment).trim();

    if (!Number.isFinite(restaurantId))
      return res.status(400).json({ error: "invalid restaurant id" });
    if (!Number.isFinite(rating) || rating < 1 || rating > 5)
      return res.status(400).json({ error: "rating must be between 1 and 5" });

    const exists = db
      .prepare("SELECT id FROM restaurants WHERE id = ?")
      .get(restaurantId);
    if (!exists) return res.status(404).json({ error: "restaurant not found" });

    db.prepare(
      `
    INSERT INTO reviews(restaurant_id, user_id, rating, comment) VALUES (?, ?, ?, ?)
    ON CONFLICT(restaurant_id, user_id) DO UPDATE SET
      rating = excluded.rating, comment = excluded.comment, updated_at = CURRENT_TIMESTAMP
  `,
    ).run(restaurantId, req.user.id, Math.round(rating), comment);

    const review = db
      .prepare(
        `
    SELECT id, rating, comment, created_at AS createdAt, updated_at AS updatedAt
    FROM reviews WHERE restaurant_id = ? AND user_id = ?
  `,
      )
      .get(restaurantId, req.user.id);

    return res.status(201).json({ review });
  },
);

app.put(
  "/api/restaurants/:id/reviews/:reviewId",
  requireAuth,
  requireRole("customer"),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    const reviewId = Number(req.params.reviewId);
    const rating = Number(req.body.rating);
    const comment =
      req.body.comment == null ? null : String(req.body.comment).trim();

    if (!Number.isFinite(restaurantId) || !Number.isFinite(reviewId))
      return res.status(400).json({ error: "invalid id" });
    if (!Number.isFinite(rating) || rating < 1 || rating > 5)
      return res.status(400).json({ error: "rating must be between 1 and 5" });

    const review = db
      .prepare("SELECT * FROM reviews WHERE id = ? AND restaurant_id = ?")
      .get(reviewId, restaurantId);
    if (!review) return res.status(404).json({ error: "review not found" });
    if (review.user_id !== req.user.id)
      return res
        .status(403)
        .json({ error: "you can only edit your own review" });

    db.prepare(
      "UPDATE reviews SET rating = ?, comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(Math.round(rating), comment, reviewId);

    const updated = db
      .prepare(
        "SELECT id, rating, comment, created_at AS createdAt, updated_at AS updatedAt FROM reviews WHERE id = ?",
      )
      .get(reviewId);
    return res.json({ review: updated });
  },
);

app.delete(
  "/api/restaurants/:id/reviews/:reviewId",
  requireAuth,
  requireRole("customer", "moderator"),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    const reviewId = Number(req.params.reviewId);
    if (!Number.isFinite(restaurantId) || !Number.isFinite(reviewId))
      return res.status(400).json({ error: "invalid id" });

    const review = db
      .prepare("SELECT * FROM reviews WHERE id = ? AND restaurant_id = ?")
      .get(reviewId, restaurantId);
    if (!review) return res.status(404).json({ error: "review not found" });
    if (req.user.role !== "moderator" && review.user_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: "you can only delete your own review" });
    }

    db.prepare("DELETE FROM reviews WHERE id = ?").run(reviewId);
    return res.json({ ok: true });
  },
);

// Shorthand delete review (for moderator use from details panel)
app.delete(
  "/api/reviews/:reviewId",
  requireAuth,
  requireRole("customer", "moderator"),
  (req, res) => {
    const reviewId = Number(req.params.reviewId);
    if (!Number.isFinite(reviewId))
      return res.status(400).json({ error: "invalid review id" });

    const review = db
      .prepare("SELECT * FROM reviews WHERE id = ?")
      .get(reviewId);
    if (!review) return res.status(404).json({ error: "review not found" });
    if (req.user.role !== "moderator" && review.user_id !== req.user.id) {
      return res
        .status(403)
        .json({ error: "you can only delete your own review" });
    }

    db.prepare("DELETE FROM reviews WHERE id = ?").run(reviewId);
    return res.json({ ok: true });
  },
);

// ─── Owner / Moderator Restaurant Management ──────────────────────────────────
app.get(
  "/api/owner/restaurants",
  requireAuth,
  requireRole("owner", "moderator"),
  (req, res) => {
    const whereClause =
      req.user.role === "moderator" ? "" : "WHERE r.owner_id = ?";
    const params = req.user.role === "moderator" ? [] : [req.user.id];

    const restaurants = db
      .prepare(
        `
    SELECT r.*, COUNT(DISTINCT m.id) AS menuItemCount, COUNT(DISTINCT i.id) AS imageCount
    FROM restaurants r
    LEFT JOIN menu_items m ON m.restaurant_id = r.id
    LEFT JOIN restaurant_images i ON i.restaurant_id = r.id
    ${whereClause}
    GROUP BY r.id ORDER BY r.created_at DESC
  `,
      )
      .all(...params)
      .map((row) => ({
        ...normalizeRestaurantRow(row),
        menuItemCount: Number(row.menuItemCount || 0),
        imageCount: Number(row.imageCount || 0),
      }));

    return res.json({ restaurants });
  },
);

app.post(
  "/api/owner/restaurants",
  requireAuth,
  requireRole("owner", "moderator"),
  (req, res) => {
    const parsed = parseRestaurantPayload(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { values } = parsed;
    const info = db
      .prepare(
        `
    INSERT INTO restaurants(
      owner_id, name, address, lat, lng, description, phone, website, opening_hours,
      menu_url, cuisine_tags, dietary_tags, google_place_id, google_rating, google_rating_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
      )
      .run(
        req.user.id,
        values.name,
        values.address,
        values.lat,
        values.lng,
        values.description,
        values.phone,
        values.website,
        values.openingHours,
        values.menuUrl,
        JSON.stringify(values.cuisineTags),
        JSON.stringify(values.dietaryTags),
        null,
        null,
        0,
      );

    const restaurant = getRestaurantWithAggregates(info.lastInsertRowid);
    return res.status(201).json({ restaurant });
  },
);

app.put(
  "/api/owner/restaurants/:id",
  requireAuth,
  requireRole("owner", "moderator"),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    if (!Number.isFinite(restaurantId))
      return res.status(400).json({ error: "invalid restaurant id" });

    const existing = db
      .prepare("SELECT * FROM restaurants WHERE id = ?")
      .get(restaurantId);
    if (!existing || !canManageRestaurant(req.user, existing)) {
      return res.status(404).json({ error: "owned restaurant not found" });
    }

    const parsed = parseRestaurantPayload(req.body, existing);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    updateRestaurantRecord(restaurantId, parsed.values);
    const restaurant = getRestaurantWithAggregates(restaurantId);
    return res.json({ restaurant });
  },
);

app.delete(
  "/api/owner/restaurants/:id",
  requireAuth,
  requireRole("owner", "moderator"),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    if (!Number.isFinite(restaurantId))
      return res.status(400).json({ error: "invalid restaurant id" });

    const existing = db
      .prepare("SELECT id, owner_id FROM restaurants WHERE id = ?")
      .get(restaurantId);
    if (!existing || !canManageRestaurant(req.user, existing)) {
      return res.status(404).json({ error: "owned restaurant not found" });
    }

    db.prepare("DELETE FROM restaurants WHERE id = ?").run(restaurantId);
    return res.json({ ok: true });
  },
);

app.post(
  "/api/owner/restaurants/:id/images",
  requireAuth,
  requireRole("owner", "moderator"),
  upload.array("images", 10),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    if (!Number.isFinite(restaurantId))
      return res.status(400).json({ error: "invalid restaurant id" });

    const existing = db
      .prepare("SELECT id, owner_id FROM restaurants WHERE id = ?")
      .get(restaurantId);
    if (!existing || !canManageRestaurant(req.user, existing)) {
      return res.status(404).json({ error: "owned restaurant not found" });
    }

    const imageUrl = safeHttpUrl(req.body.imageUrl);
    if ((!req.files || req.files.length === 0) && !imageUrl) {
      return res
        .status(400)
        .json({ error: "at least one image URL or file is required" });
    }

    const hasCover = db
      .prepare(
        "SELECT id FROM restaurant_images WHERE restaurant_id = ? AND is_cover = 1",
      )
      .get(restaurantId);
    const insert = db.prepare(
      "INSERT INTO restaurant_images(restaurant_id, url, is_cover) VALUES (?, ?, ?)",
    );
    const inserted = [];

    if (imageUrl) {
      const isCover = hasCover ? 0 : 1;
      const info = insert.run(restaurantId, imageUrl, isCover);
      inserted.push({
        id: info.lastInsertRowid,
        url: imageUrl,
        isCover: Boolean(isCover),
      });
    }

    (req.files || []).forEach((file, index) => {
      const isCover = !hasCover && !inserted.length && index === 0 ? 1 : 0;
      const url = `/uploads/${file.filename}`;
      const info = insert.run(restaurantId, url, isCover);
      inserted.push({
        id: info.lastInsertRowid,
        url,
        isCover: Boolean(isCover),
      });
    });

    return res.status(201).json({ images: inserted });
  },
);

app.post(
  "/api/owner/restaurants/:id/menu-items",
  requireAuth,
  requireRole("owner", "moderator"),
  upload.single("image"),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    if (!Number.isFinite(restaurantId))
      return res.status(400).json({ error: "invalid restaurant id" });

    const owned = db
      .prepare("SELECT id, owner_id FROM restaurants WHERE id = ?")
      .get(restaurantId);
    if (!owned || !canManageRestaurant(req.user, owned)) {
      return res.status(404).json({ error: "owned restaurant not found" });
    }

    const { name, description, price } = req.body;
    const parsedPrice = Number(price);
    if (!name || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return res
        .status(400)
        .json({ error: "name and non-negative price are required" });
    }

    const imageUrl = req.file
      ? `/uploads/${req.file.filename}`
      : safeHttpUrl(req.body.imageUrl);
    const info = db
      .prepare(
        "INSERT INTO menu_items(restaurant_id, name, description, price, image_url) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        restaurantId,
        String(name).trim(),
        description ? String(description).trim() : null,
        parsedPrice,
        imageUrl,
      );

    const item = db
      .prepare(
        "SELECT id, name, description, price, image_url AS imageUrl, created_at AS createdAt, updated_at AS updatedAt FROM menu_items WHERE id = ?",
      )
      .get(info.lastInsertRowid);

    return res.status(201).json({ item });
  },
);

app.put(
  "/api/owner/restaurants/:id/menu-items/:itemId",
  requireAuth,
  requireRole("owner", "moderator"),
  upload.single("image"),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(restaurantId) || !Number.isFinite(itemId))
      return res.status(400).json({ error: "invalid ids" });

    const owned = db
      .prepare("SELECT id, owner_id FROM restaurants WHERE id = ?")
      .get(restaurantId);
    if (!owned || !canManageRestaurant(req.user, owned))
      return res.status(404).json({ error: "owned restaurant not found" });

    const existingItem = db
      .prepare("SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?")
      .get(itemId, restaurantId);
    if (!existingItem)
      return res.status(404).json({ error: "menu item not found" });

    const nextName = req.body.name
      ? String(req.body.name).trim()
      : existingItem.name;
    const nextDescription =
      req.body.description == null
        ? existingItem.description
        : String(req.body.description).trim();
    const nextPrice =
      req.body.price == null
        ? existingItem.price
        : Number.isFinite(Number(req.body.price))
          ? Number(req.body.price)
          : existingItem.price;
    if (!Number.isFinite(nextPrice) || nextPrice < 0)
      return res
        .status(400)
        .json({ error: "price must be a non-negative number" });

    const nextImage = req.file
      ? `/uploads/${req.file.filename}`
      : safeHttpUrl(req.body.imageUrl) || existingItem.image_url;

    db.prepare(
      "UPDATE menu_items SET name = ?, description = ?, price = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(nextName, nextDescription, nextPrice, nextImage, itemId);

    const item = db
      .prepare(
        "SELECT id, name, description, price, image_url AS imageUrl, created_at AS createdAt, updated_at AS updatedAt FROM menu_items WHERE id = ?",
      )
      .get(itemId);

    return res.json({ item });
  },
);

app.delete(
  "/api/owner/restaurants/:id/menu-items/:itemId",
  requireAuth,
  requireRole("owner", "moderator"),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(restaurantId) || !Number.isFinite(itemId))
      return res.status(400).json({ error: "invalid ids" });

    const owned = db
      .prepare("SELECT id, owner_id FROM restaurants WHERE id = ?")
      .get(restaurantId);
    if (!owned || !canManageRestaurant(req.user, owned))
      return res.status(404).json({ error: "owned restaurant not found" });

    const existingItem = db
      .prepare("SELECT id FROM menu_items WHERE id = ? AND restaurant_id = ?")
      .get(itemId, restaurantId);
    if (!existingItem)
      return res.status(404).json({ error: "menu item not found" });

    db.prepare("DELETE FROM menu_items WHERE id = ?").run(itemId);
    return res.json({ ok: true });
  },
);

// ─── Moderator: Restaurant Visibility ────────────────────────────────────────
app.put(
  "/api/owner/restaurants/:id/visibility",
  requireAuth,
  requireRole("moderator"),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    if (!Number.isFinite(restaurantId))
      return res.status(400).json({ error: "invalid restaurant id" });

    const isHidden = Boolean(req.body.isHidden);
    const reason = String(req.body.reason || "").trim() || null;
    const existing = db
      .prepare("SELECT id FROM restaurants WHERE id = ?")
      .get(restaurantId);
    if (!existing)
      return res.status(404).json({ error: "restaurant not found" });

    db.prepare(
      `
    UPDATE restaurants
    SET is_hidden = ?, hidden_reason = ?, hidden_at = ?, hidden_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
    ).run(
      isHidden ? 1 : 0,
      isHidden ? reason : null,
      isHidden ? new Date().toISOString() : null,
      isHidden ? req.user.id : null,
      restaurantId,
    );

    return res.json({ restaurantId, isHidden });
  },
);

// ─── Moderator: User Management ───────────────────────────────────────────────
app.get(
  "/api/moderation/users",
  requireAuth,
  requireRole("moderator"),
  (_req, res) => {
    const users = db
      .prepare(
        "SELECT id, name, email, role, is_banned, banned_at, banned_reason FROM users ORDER BY name ASC",
      )
      .all()
      .map(sanitizeUser);

    return res.json({ users });
  },
);

app.put(
  "/api/moderation/users/:id/ban",
  requireAuth,
  requireRole("moderator"),
  (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId))
      return res.status(400).json({ error: "invalid user id" });
    if (userId === Number(req.user.id))
      return res
        .status(400)
        .json({ error: "Moderators cannot suspend themselves." });

    const isBanned = Boolean(req.body.isBanned);
    const reason = String(req.body.reason || "").trim() || null;
    const existing = db
      .prepare("SELECT id FROM users WHERE id = ?")
      .get(userId);
    if (!existing) return res.status(404).json({ error: "user not found" });

    db.prepare(
      `
    UPDATE users SET is_banned = ?, banned_at = ?, banned_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `,
    ).run(
      isBanned ? 1 : 0,
      isBanned ? new Date().toISOString() : null,
      isBanned ? reason : null,
      userId,
    );

    return res.json({ userId, isBanned });
  },
);

app.delete(
  "/api/moderation/users/:id",
  requireAuth,
  requireRole("moderator"),
  (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isFinite(userId))
      return res.status(400).json({ error: "invalid user id" });
    if (userId === Number(req.user.id))
      return res
        .status(400)
        .json({ error: "Moderators cannot delete themselves." });

    const existing = db
      .prepare("SELECT id, role FROM users WHERE id = ?")
      .get(userId);
    if (!existing) return res.status(404).json({ error: "user not found" });
    if (existing.role === "moderator")
      return res
        .status(400)
        .json({ error: "Moderators cannot delete other moderators." });

    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    return res.json({ deletedUserId: userId });
  },
);

// ─── Menu Search ───────────────────────────────────────────────────────────────
app.get("/api/dishes/search", (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "q is required" });

  const items = db
    .prepare(
      `
    SELECT m.*, r.name as restaurantName
    FROM menu_items m
    JOIN restaurants r ON m.restaurant_id = r.id
    WHERE m.name LIKE ?
  `,
    )
    .all(`%${query}%`);

  return res.json({ items });
});

// ─── SPA catch-all ────────────────────────────────────────────────────────────
app.get("*", (_req, res) => {
  return res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  return res
    .status(500)
    .json({ error: err.message || "internal server error" });
});

module.exports = app;
