"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  GOOGLE_MAX_SEARCH_CELLS,
  GOOGLE_MAX_RADIUS_METERS,
  GEMINI_MODEL,
  GOOGLE_MAX_RESULTS,
  GOOGLE_MIN_RESULTS,
  GOOGLE_TARGET_RESULTS,
  buildNearbyCacheKey,
  extractCuisineTags,
  extractDietaryTags,
  extractDisplayText,
  extractOpeningHours,
  getNearbyRadiusMeters,
  isCacheFresh,
  sanitizeMenuItems,
  shouldUseGemini,
} from "./googleHelpers";
import { normalizeHttpUrl, normalizeOptionalString, nowIso } from "./authHelpers";

const GOOGLE_PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";
const GOOGLE_PLACE_PHOTO_ENDPOINT = "https://places.googleapis.com/v1";
const GOOGLE_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.rating",
  "places.userRatingCount",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.regularOpeningHours",
  "places.photos",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.editorialSummary",
  "places.servesVegetarianFood",
  "places.delivery",
  "places.takeout",
  "places.dineIn",
].join(",");

const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    restaurants: {
      type: "array",
      description:
        "Gemini enrichment keyed by Google Place ID. Use empty arrays when the evidence is weak.",
      items: {
        type: "object",
        properties: {
          placeId: {
            type: "string",
            description: "The Google Place ID from the input list.",
          },
          cuisineTags: {
            type: "array",
            description:
              "Up to six helpful discovery tags as lowercase slugs such as cafe, coffee, bakery, breakfast, brunch, sandwiches, donuts, vegetarian-friendly, vegan-friendly, dessert, ramen, sushi, quick-bites.",
            items: {
              type: "string",
            },
          },
          displayTags: {
            type: "array",
            description:
              "Up to six short, frontend-friendly tag chips in lowercase slug form. Prefer concise labels such as coffee, breakfast, brunch, sushi, vegetarian-friendly, gluten-free-friendly, family-friendly.",
            items: {
              type: "string",
            },
          },
          dietaryTags: {
            type: "array",
            description:
              "Only use likely dietary tags from this set: vegan, vegetarian, halal, kosher, gluten-free.",
            items: {
              type: "string",
              enum: ["vegan", "vegetarian", "halal", "kosher", "gluten-free"],
            },
          },
          filterTags: {
            type: "array",
            description:
              "Strict filter tags for the app. Only use likely values from this set: vegan, vegetarian, halal, kosher, gluten-free.",
            items: {
              type: "string",
              enum: ["vegan", "vegetarian", "halal", "kosher", "gluten-free"],
            },
          },
          menuItems: {
            type: "array",
            description:
              "Up to five likely menu items inferred from the place metadata. Use empty arrays if unsure.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: {
                  type: ["string", "null"],
                },
              },
              required: ["name", "description"],
            },
          },
        },
        required: ["placeId", "cuisineTags", "displayTags", "dietaryTags", "filterTags", "menuItems"],
      },
    },
  },
  required: ["restaurants"],
};

function parseJsonResponse(text: string) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return null;
  }
}

async function getPhotoUri(photoName: string, apiKey: string) {
  const photoUrl = new URL(`${GOOGLE_PLACE_PHOTO_ENDPOINT}/${photoName}/media`);
  photoUrl.searchParams.set("key", apiKey);
  photoUrl.searchParams.set("maxHeightPx", "900");
  photoUrl.searchParams.set("skipHttpRedirect", "true");

  const response = await fetch(photoUrl.toString());
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return typeof payload?.photoUri === "string" ? payload.photoUri : null;
}

async function fetchGooglePlaces({
  apiKey,
  lat,
  lng,
  radiusMeters,
}: {
  apiKey: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}) {
  const response = await fetch(GOOGLE_PLACES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
    },
    body: JSON.stringify({
      includedTypes: ["restaurant"],
      maxResultCount: GOOGLE_MAX_RESULTS,
      locationRestriction: {
        circle: {
          center: {
            latitude: lat,
            longitude: lng,
          },
          radius: radiusMeters,
        },
      },
      rankPreference: "POPULARITY",
      languageCode: "en",
    }),
  });

  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`Google Places sync failed: ${payload || response.status}`);
  }

  const payload = await response.json();
  return Array.isArray(payload?.places) ? payload.places : [];
}

async function fetchExpandedNearbyPlaces({
  apiKey,
  lat,
  lng,
  radiusMeters,
}: {
  apiKey: string;
  lat: number;
  lng: number;
  radiusMeters: number;
}) {
  let effectiveRadius = Math.max(1000, Math.round(radiusMeters));
  const uniquePlaces = new Map<string, any>();
  const searchedCenters = new Set<string>();

  const upsertPlaces = (places: any[]) => {
    for (const place of places) {
      const placeId = String(place?.id || "").trim();
      if (placeId && !uniquePlaces.has(placeId)) {
        uniquePlaces.set(placeId, place);
      }
    }
  };

  const fetchAtCenter = async (centerLat: number, centerLng: number, nextRadiusMeters: number) => {
    const centerKey = `${centerLat.toFixed(4)}:${centerLng.toFixed(4)}:${Math.round(nextRadiusMeters)}`;
    if (searchedCenters.has(centerKey) || searchedCenters.size >= GOOGLE_MAX_SEARCH_CELLS) {
      return;
    }

    searchedCenters.add(centerKey);
    const places = await fetchGooglePlaces({
      apiKey,
      lat: centerLat,
      lng: centerLng,
      radiusMeters: nextRadiusMeters,
    });
    upsertPlaces(places);
  };

  await fetchAtCenter(lat, lng, effectiveRadius);

  while (uniquePlaces.size < GOOGLE_MIN_RESULTS && effectiveRadius < GOOGLE_MAX_RADIUS_METERS) {
    effectiveRadius = Math.min(effectiveRadius * 2, GOOGLE_MAX_RADIUS_METERS);
    await fetchAtCenter(lat, lng, effectiveRadius);
  }

  if (uniquePlaces.size < GOOGLE_TARGET_RESULTS) {
    const latStep = (effectiveRadius * 0.6) / 111320;
    const lngStep =
      latStep / Math.max(Math.cos((lat * Math.PI) / 180), 0.25);
    const offsets = [
      [latStep, 0],
      [-latStep, 0],
      [0, lngStep],
      [0, -lngStep],
      [latStep, lngStep],
      [latStep, -lngStep],
      [-latStep, lngStep],
      [-latStep, -lngStep],
    ];

    for (const [latOffset, lngOffset] of offsets) {
      if (uniquePlaces.size >= GOOGLE_TARGET_RESULTS) {
        break;
      }

      await fetchAtCenter(lat + latOffset, lng + lngOffset, effectiveRadius);
    }
  }

  return {
    places: Array.from(uniquePlaces.values()),
    effectiveRadius,
  };
}

async function fetchGeminiEnrichment(places: any[]) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const candidates = places
    .filter((place) => shouldUseGemini(place))
    .slice(0, 15)
    .map((place) => ({
      placeId: String(place?.id || ""),
      name: extractDisplayText(place?.displayName),
      primaryType: String(place?.primaryType || ""),
      primaryTypeDisplayName: extractDisplayText(place?.primaryTypeDisplayName),
      types: Array.isArray(place?.types) ? place.types.slice(0, 8) : [],
      formattedAddress: String(place?.formattedAddress || ""),
      websiteUri: String(place?.websiteUri || ""),
      editorialSummary: extractDisplayText(place?.editorialSummary),
      servesVegetarianFood: Boolean(place?.servesVegetarianFood),
      delivery: Boolean(place?.delivery),
      dineIn: Boolean(place?.dineIn),
      takeout: Boolean(place?.takeout),
    }))
    .filter((place) => place.placeId);

  if (!apiKey || !candidates.length) {
    return new Map<
      string,
      { cuisineTags: string[]; displayTags: string[]; dietaryTags: string[]; filterTags: string[]; menuItems: any[] }
    >();
  }

  const prompt = [
    "You are enriching restaurant records for a food discovery app.",
    "Use only the provided metadata. If you are unsure, return empty arrays instead of inventing details.",
    "Infer likely cuisine tags, display tags, strict filter tags, dietary tags, and up to five menu items for each restaurant.",
    "Cuisine tags should be broad discovery tags, not just cuisines. Good examples include coffee, cafe, bakery, breakfast, brunch, dessert, sandwiches, quick-bites, bubble-tea, noodles, vegetarian-friendly, gluten-free-friendly, and vegan-friendly.",
    "Display tags should be the cleanest frontend-ready chips to show on cards.",
    "Filter tags and dietary tags must stay conservative and only use the allowed dietary set when the evidence is reasonably strong.",
    "Menu items are fallback suggestions only, so do not include prices and do not claim certainty.",
    JSON.stringify(candidates),
  ].join("\n\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: GEMINI_RESPONSE_SCHEMA,
        },
      }),
    },
  );

  if (!response.ok) {
    return new Map();
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = typeof text === "string" ? parseJsonResponse(text) : null;
  const enrichedRestaurants = Array.isArray(parsed?.restaurants) ? parsed.restaurants : [];

  return new Map(
    enrichedRestaurants.map((restaurant: any) => [
      String(restaurant?.placeId || ""),
      {
        cuisineTags: Array.isArray(restaurant?.cuisineTags) ? restaurant.cuisineTags : [],
        displayTags: Array.isArray(restaurant?.displayTags) ? restaurant.displayTags : [],
        dietaryTags: Array.isArray(restaurant?.dietaryTags) ? restaurant.dietaryTags : [],
        filterTags: Array.isArray(restaurant?.filterTags) ? restaurant.filterTags : [],
        menuItems: Array.isArray(restaurant?.menuItems) ? restaurant.menuItems : [],
      },
    ]),
  );
}

async function fetchGeminiRestaurantRefresh(restaurants: any[]) {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  const candidates = restaurants
    .slice(0, 20)
    .map((restaurant) => ({
      restaurantId: String(restaurant?._id || ""),
      name: String(restaurant?.name || ""),
      address: String(restaurant?.address || ""),
      description: String(restaurant?.description || ""),
      website: String(restaurant?.website || ""),
      primaryType: String(restaurant?.primaryType || ""),
      openingHours: String(restaurant?.openingHours || ""),
      cuisineTags: Array.isArray(restaurant?.cuisineTags) ? restaurant.cuisineTags.slice(0, 10) : [],
      dietaryTags: Array.isArray(restaurant?.dietaryTags) ? restaurant.dietaryTags.slice(0, 10) : [],
      menuItems: Array.isArray(restaurant?.menuItems)
        ? restaurant.menuItems.slice(0, 6).map((item: any) => ({
            name: String(item?.name || ""),
            description: String(item?.description || ""),
          }))
        : [],
    }))
    .filter((restaurant) => restaurant.restaurantId && restaurant.name);

  if (!apiKey || !candidates.length) {
    return new Map<
      string,
      { cuisineTags: string[]; displayTags: string[]; dietaryTags: string[]; filterTags: string[]; menuItems: any[] }
    >();
  }

  const prompt = [
    "You are improving restaurant discovery tags for a food app.",
    "Return only helpful discovery tags supported by the provided restaurant metadata.",
    "Cuisine tags should be broad and useful for browsing, such as coffee, cafe, bakery, donuts, breakfast, brunch, sandwiches, desserts, quick-bites, vegetarian-friendly, gluten-free-friendly, vegan-friendly, noodles, sushi, tacos, seafood, or family-friendly.",
    "Display tags should be the cleanest frontend-ready chips to show on cards and details.",
    "Filter tags and dietary tags must stay conservative and only use likely values from this set: vegan, vegetarian, halal, kosher, gluten-free.",
    "If current tags already seem useful, you may keep them and add a few more. Do not remove obviously correct tags.",
    "Menu items are fallback guesses only and should be short plain names without prices.",
    JSON.stringify(candidates),
  ].join("\n\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseJsonSchema: {
            type: "object",
            properties: {
              restaurants: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    restaurantId: { type: "string" },
                    cuisineTags: { type: "array", items: { type: "string" } },
                    displayTags: { type: "array", items: { type: "string" } },
                    dietaryTags: {
                      type: "array",
                      items: {
                        type: "string",
                        enum: ["vegan", "vegetarian", "halal", "kosher", "gluten-free"],
                      },
                    },
                    filterTags: {
                      type: "array",
                      items: {
                        type: "string",
                        enum: ["vegan", "vegetarian", "halal", "kosher", "gluten-free"],
                      },
                    },
                    menuItems: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          description: { type: ["string", "null"] },
                        },
                        required: ["name", "description"],
                      },
                    },
                  },
                  required: [
                    "restaurantId",
                    "cuisineTags",
                    "displayTags",
                    "dietaryTags",
                    "filterTags",
                    "menuItems"
                  ],
                },
              },
            },
            required: ["restaurants"],
          },
        },
      }),
    },
  );

  if (!response.ok) {
    return new Map();
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = typeof text === "string" ? parseJsonResponse(text) : null;
  const enrichedRestaurants = Array.isArray(parsed?.restaurants) ? parsed.restaurants : [];

  return new Map(
    enrichedRestaurants.map((restaurant: any) => [
      String(restaurant?.restaurantId || ""),
      {
        cuisineTags: Array.isArray(restaurant?.cuisineTags) ? restaurant.cuisineTags : [],
        displayTags: Array.isArray(restaurant?.displayTags) ? restaurant.displayTags : [],
        dietaryTags: Array.isArray(restaurant?.dietaryTags) ? restaurant.dietaryTags : [],
        filterTags: Array.isArray(restaurant?.filterTags) ? restaurant.filterTags : [],
        menuItems: Array.isArray(restaurant?.menuItems) ? restaurant.menuItems : [],
      },
    ]),
  );
}

async function normalizePlace(place: any, apiKey: string, syncedAt: string, geminiEnrichment?: any) {
  const photoEntries = Array.isArray(place?.photos) ? place.photos.slice(0, 2) : [];
  const imageResults = await Promise.all(
    photoEntries.map(async (photo: any, index: number) => {
      const photoName = String(photo?.name || "").trim();
      if (!photoName) {
        return null;
      }

      const photoUri = await getPhotoUri(photoName, apiKey);
      if (!photoUri) {
        return null;
      }

      const authorAttributions = Array.isArray(photo?.authorAttributions)
        ? photo.authorAttributions.map((attribution: any) => ({
            displayName: attribution?.displayName || null,
            uri: attribution?.uri || null,
            photoUri: attribution?.photoUri || null,
          }))
        : undefined;

      return {
        url: photoUri,
        isCover: index === 0,
        authorAttributions,
      };
    }),
  );

  const images = imageResults.filter(Boolean);
  const menuItems = sanitizeMenuItems(
    (geminiEnrichment?.menuItems || []).map((item: any) => ({
      name: item?.name,
      description: item?.description,
      price: 0,
    })),
  );

  const googlePlaceId = String(place?.id || "").trim();

  return {
    googlePlaceId,
    source: "google",
    syncStatus: "complete",
    lastSyncedAt: syncedAt,
    name: normalizeOptionalString(extractDisplayText(place?.displayName), 120) || "Google restaurant",
    address: normalizeOptionalString(place?.formattedAddress, 240) || "Address unavailable",
    lat: Number(place?.location?.latitude || 0),
    lng: Number(place?.location?.longitude || 0),
    description:
      normalizeOptionalString(extractDisplayText(place?.editorialSummary), 1500) ||
      normalizeOptionalString(extractDisplayText(place?.primaryTypeDisplayName), 120),
    phone: normalizeOptionalString(place?.nationalPhoneNumber, 80),
    website: normalizeHttpUrl(place?.websiteUri),
    googleMapsUri: googlePlaceId
      ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(
          googlePlaceId,
        )}`
      : null,
    openingHours: normalizeOptionalString(extractOpeningHours(place), 400),
    menuUrl: null,
    primaryType: normalizeOptionalString(place?.primaryType, 120),
    cuisineTags: extractCuisineTags(place, geminiEnrichment?.cuisineTags || []),
    dietaryTags: extractDietaryTags(place, [
      ...(geminiEnrichment?.dietaryTags || []),
      ...(geminiEnrichment?.filterTags || []),
    ]),
    coverImage: images[0]?.url || null,
    images,
    menuItems,
    googleRating: Number.isFinite(Number(place?.rating)) ? Number(place.rating) : null,
    googleRatingCount: Number.isFinite(Number(place?.userRatingCount))
      ? Number(place.userRatingCount)
      : 0,
  };
}

export const syncNearbyFromGoogle = action({
  args: {
    lat: v.number(),
    lng: v.number(),
    radiusMeters: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const apiKey = String(
      process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "",
    ).trim();
    const radiusMeters = Number(args.radiusMeters || getNearbyRadiusMeters());
    const cacheKey = buildNearbyCacheKey(args.lat, args.lng, radiusMeters);
    const syncedAt = nowIso();
    const existingCache = await ctx.runQuery(internal.googleSyncStore.getNearbySyncCache, {
      cacheKey,
    });

    if (!apiKey) {
      return {
        status: "skipped",
        reason: "missing_google_maps_api_key",
        cacheKey,
      };
    }

    if (!args.force && existingCache?.status === "complete" && isCacheFresh(existingCache.lastSyncedAt)) {
      return {
        status: "cached",
        cacheKey,
        itemCount: existingCache.itemCount,
        lastSyncedAt: existingCache.lastSyncedAt,
      };
    }

    try {
      const { places: rawPlaces, effectiveRadius } = await fetchExpandedNearbyPlaces({
        apiKey,
        lat: args.lat,
        lng: args.lng,
        radiusMeters,
      });
      const geminiByPlaceId = await fetchGeminiEnrichment(rawPlaces);
      const normalizedPlaces = [];

      for (const place of rawPlaces) {
        const googlePlaceId = String(place?.id || "").trim();
        if (!googlePlaceId) {
          continue;
        }

        normalizedPlaces.push(
          await normalizePlace(place, apiKey, syncedAt, geminiByPlaceId.get(googlePlaceId)),
        );
      }

      const result = await ctx.runMutation(internal.googleSyncStore.upsertGoogleRestaurants, {
        restaurants: normalizedPlaces,
      });
      await ctx.runMutation(internal.googleSyncStore.recordNearbySyncResult, {
        cacheKey,
        centerLat: args.lat,
        centerLng: args.lng,
        radiusMeters: effectiveRadius,
        status: "complete",
        source: "google_places",
        itemCount: normalizedPlaces.length,
        lastAttemptAt: syncedAt,
        lastSyncedAt: syncedAt,
        errorMessage: null,
      });

      return {
        status: "complete",
        cacheKey,
        itemCount: normalizedPlaces.length,
        radiusMeters: effectiveRadius,
        inserted: result.inserted,
        updated: result.updated,
      };
    } catch (error: any) {
      const message = String(error?.message || "Unknown Google sync error");
      await ctx.runMutation(internal.googleSyncStore.recordNearbySyncResult, {
        cacheKey,
        centerLat: args.lat,
        centerLng: args.lng,
        radiusMeters,
        status: "error",
        source: "google_places",
        itemCount: 0,
        lastAttemptAt: syncedAt,
        lastSyncedAt: existingCache?.lastSyncedAt || null,
        errorMessage: message,
      });

      return {
        status: "error",
        cacheKey,
        reason: message,
      };
    }
  },
});

export const enrichRestaurantTags = action({
  args: {
    restaurantIds: v.array(v.id("restaurants")),
  },
  handler: async (ctx, args) => {
    const restaurants = await ctx.runQuery(internal.googleSyncStore.getRestaurantsForTagEnrichment, {
      restaurantIds: args.restaurantIds,
    });

    const candidates = restaurants.filter(
      (restaurant: any) => restaurant?.source === "google" && String(restaurant?.googlePlaceId || "").trim(),
    );

    if (!candidates.length) {
      return { updated: [] };
    }

    const geminiByRestaurantId = await fetchGeminiRestaurantRefresh(candidates);
    const updates = candidates
      .map((restaurant: any) => {
        const enrichment = geminiByRestaurantId.get(String(restaurant._id));
        if (!enrichment) {
          return null;
        }

        const placeLikeRecord = {
          displayName: restaurant.name,
          formattedAddress: restaurant.address,
          editorialSummary: restaurant.description,
          websiteUri: restaurant.website,
          primaryType: restaurant.primaryType,
          primaryTypeDisplayName: restaurant.primaryType,
          types: restaurant.cuisineTags || [],
          regularOpeningHours: {
            weekdayDescriptions: restaurant.openingHours
              ? String(restaurant.openingHours)
                  .split("|")
                  .map((part) => String(part).trim())
                  .filter(Boolean)
              : [],
          },
          servesVegetarianFood: Array.isArray(restaurant.dietaryTags)
            ? restaurant.dietaryTags.includes("vegetarian")
            : false,
        };

        return {
          restaurantId: restaurant._id,
          cuisineTags: extractCuisineTags(placeLikeRecord, [
            ...(enrichment.cuisineTags || []),
            ...(enrichment.displayTags || []),
          ]),
          dietaryTags: extractDietaryTags(placeLikeRecord, [
            ...(enrichment.dietaryTags || []),
            ...(enrichment.filterTags || []),
          ]),
          menuItems: sanitizeMenuItems(
            (enrichment.menuItems || []).map((item: any) => ({
              name: item?.name,
              description: item?.description,
              price: 0,
            })),
          ),
        };
      })
      .filter(Boolean);

    if (!updates.length) {
      return { updated: [] };
    }

    const applied = await ctx.runMutation(internal.googleSyncStore.applyGeminiRestaurantEnrichment, {
      restaurants: updates,
    });

    return { updated: applied };
  },
});
