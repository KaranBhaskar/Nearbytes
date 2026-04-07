const DEFAULT_RADIUS = Number(process.env.GOOGLE_NEARBY_RADIUS_METERS || 3000);

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(restaurant|grill|kitchen|cafe|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTruthyDietaryValue(value) {
  return ["yes", "only", "limited", "true", "1"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function inferDietaryTagsFromOsm(tags = {}) {
  const dietaryTags = new Set();

  const searchableText = Object.values(tags)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (hasTruthyDietaryValue(tags["diet:vegan"]) || searchableText.includes("vegan")) {
    dietaryTags.add("vegan");
  }

  if (
    hasTruthyDietaryValue(tags["diet:vegetarian"]) ||
    searchableText.includes("vegetarian")
  ) {
    dietaryTags.add("vegetarian");
  }

  if (hasTruthyDietaryValue(tags["diet:halal"]) || searchableText.includes("halal")) {
    dietaryTags.add("halal");
  }

  if (hasTruthyDietaryValue(tags["diet:kosher"]) || searchableText.includes("kosher")) {
    dietaryTags.add("kosher");
  }

  if (
    hasTruthyDietaryValue(tags["diet:gluten_free"]) ||
    hasTruthyDietaryValue(tags["diet:gluten-free"]) ||
    searchableText.includes("gluten free") ||
    searchableText.includes("gluten-free")
  ) {
    dietaryTags.add("gluten-free");
  }

  if (dietaryTags.has("vegan")) {
    dietaryTags.add("vegetarian");
  }

  return Array.from(dietaryTags);
}

async function fetchOsmDietaryData(lat, lng) {
  const query = `
[out:json][timeout:20];
(
  node["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${DEFAULT_RADIUS},${lat},${lng});
  way["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${DEFAULT_RADIUS},${lat},${lng});
  relation["amenity"~"^(restaurant|fast_food|cafe|food_court)$"](around:${DEFAULT_RADIUS},${lat},${lng});
);
out center tags;
`;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }),
    });

    if (!response.ok) return [];

    const payload = await response.json();

    return (payload.elements || [])
      .map((element) => {
        const tags = element.tags || {};
        const name = String(tags.name || "").trim();
        const elLat = Number(element.lat ?? element.center?.lat);
        const elLng = Number(element.lon ?? element.center?.lon);

        if (!name || !Number.isFinite(elLat) || !Number.isFinite(elLng)) {
          return null;
        }

        return {
          name,
          normalizedName: normalizeName(name),
          lat: elLat,
          lng: elLng,
          dietaryTags: inferDietaryTagsFromOsm(tags),
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn("OSM dietary fetch failed:", err.message);
    return [];
  }
}

function findBestOsmMatch(place, osmItems) {
  const placeName = normalizeName(place.name);
  const placeLat = Number(place.geometry?.location?.lat);
  const placeLng = Number(place.geometry?.location?.lng);

  if (!placeName || !Number.isFinite(placeLat) || !Number.isFinite(placeLng)) {
    return null;
  }

  let best = null;

  for (const item of osmItems) {
    const sameName = item.normalizedName === placeName;
    if (!sameName) continue;

    const distanceKm = haversineKm(placeLat, placeLng, item.lat, item.lng);
    if (distanceKm > 0.25) continue;

    if (!best || distanceKm < best.distanceKm) {
      best = { ...item, distanceKm };
    }
  }

  return best;
}

async function syncGoogleNearby(db, lat, lng) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.warn("Google sync failed: missing API key");
    return { synced: 0, reason: "missing_api_key" };
  }

  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("radius", String(DEFAULT_RADIUS));
  url.searchParams.set("type", "restaurant");
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    console.warn(`Google sync failed: HTTP ${response.status}`);
    return { synced: 0, reason: `http_${response.status}` };
  }

  const payload = await response.json();

  if (!["OK", "ZERO_RESULTS"].includes(payload.status)) {
    console.warn("Google API status:", payload.status, payload.error_message || "");
    return { synced: 0, reason: payload.status || "unknown_status" };
  }

  if (!Array.isArray(payload.results) || payload.results.length === 0) {
    return { synced: 0, reason: "zero_results" };
  }

  const osmItems = await fetchOsmDietaryData(lat, lng);

  const upsert = db.prepare(`
    INSERT INTO restaurants (
      owner_id,
      name,
      address,
      lat,
      lng,
      description,
      phone,
      website,
      cuisine_tags,
      dietary_tags,
      google_place_id,
      google_rating,
      google_rating_count,
      google_photo_ref
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(google_place_id)
    DO UPDATE SET
      name = excluded.name,
      address = excluded.address,
      lat = excluded.lat,
      lng = excluded.lng,
      google_rating = excluded.google_rating,
      google_rating_count = excluded.google_rating_count,
      google_photo_ref = COALESCE(excluded.google_photo_ref, restaurants.google_photo_ref),
      dietary_tags = CASE
        WHEN excluded.dietary_tags IS NOT NULL AND excluded.dietary_tags != '[]'
        THEN excluded.dietary_tags
        ELSE restaurants.dietary_tags
      END,
      updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction((results) => {
    let syncedCount = 0;

    for (const place of results) {
      const placeId = place.place_id;
      const location = place.geometry?.location;

      if (!placeId || !location) continue;

      const osmMatch = findBestOsmMatch(place, osmItems);
      let dietaryTags = osmMatch ? osmMatch.dietaryTags : [];

      const lowerName = String(place.name || "").toLowerCase();

      if (lowerName.includes("subway")) {
        dietaryTags = [...new Set([...dietaryTags, "vegetarian"])];
      }

      if (lowerName.includes("osmow") || lowerName.includes("shawarma")) {
        dietaryTags = [...new Set([...dietaryTags, "halal"])];
      }

      upsert.run(
        null,
        place.name || "Unnamed Restaurant",
        place.vicinity || place.formatted_address || "Unknown address",
        Number(location.lat),
        Number(location.lng),
        null,
        null,
        null,
        JSON.stringify([]),
        JSON.stringify(dietaryTags),
        placeId,
        place.rating ?? null,
        place.user_ratings_total ?? 0,
        place.photos?.[0]?.photo_reference ?? null
      );

      syncedCount += 1;
    }

    return syncedCount;
  });

  const synced = transaction(payload.results);
  console.log(`Google nearby sync inserted/updated ${synced} restaurants`);
  return { synced, reason: "ok" };
}

module.exports = { syncGoogleNearby };