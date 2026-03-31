const DEFAULT_RADIUS = Number(process.env.GOOGLE_NEARBY_RADIUS_METERS || 3000);

async function syncGoogleNearby(db, lat, lng) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return { synced: 0, reason: 'missing_api_key' };

  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('radius', String(DEFAULT_RADIUS));
  url.searchParams.set('type', 'restaurant');
  url.searchParams.set('key', apiKey);

  const response = await fetch(url.toString());
  if (!response.ok) {
    return { synced: 0, reason: `http_${response.status}` };
  }

  const payload = await response.json();
  if (!['OK', 'ZERO_RESULTS'].includes(payload.status)) {
    return { synced: 0, reason: payload.status || 'unknown_status' };
  }

  if (!Array.isArray(payload.results) || payload.results.length === 0) {
    return { synced: 0, reason: 'zero_results' };
  }

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
      google_place_id,
      google_rating,
      google_rating_count,
      google_photo_ref
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(google_place_id)
    DO UPDATE SET
      name = excluded.name,
      address = excluded.address,
      lat = excluded.lat,
      lng = excluded.lng,
      google_rating = excluded.google_rating,
      google_rating_count = excluded.google_rating_count,
      google_photo_ref = COALESCE(excluded.google_photo_ref, google_photo_ref),
      updated_at = CURRENT_TIMESTAMP
  `);

  const transaction = db.transaction((results) => {
    let syncedCount = 0;

    for (const place of results) {
      const placeId = place.place_id;
      const location = place.geometry && place.geometry.location;
      if (!placeId || !location) continue;

      upsert.run(
        null,
        place.name || 'Unnamed Restaurant',
        place.vicinity || place.formatted_address || 'Unknown address',
        Number(location.lat),
        Number(location.lng),
        null,
        null,
        null,
        null,
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
  return { synced, reason: 'ok' };
}

module.exports = { syncGoogleNearby };
