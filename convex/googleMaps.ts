"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";

type AddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GeocodeResult = {
  formatted_address?: string;
  place_id?: string;
  address_components?: AddressComponent[];
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
};

function getApiKey() {
  return String(
    process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY || "",
  ).trim();
}

async function fetchJson(url: URL) {
  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Google Maps request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  if (payload?.status && payload.status !== "OK" && payload.status !== "ZERO_RESULTS") {
    throw new Error(payload.error_message || `Google Maps error: ${payload.status}`);
  }

  return payload;
}

function firstAddressSegment(address?: string) {
  return String(address || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)[0] || null;
}

function findAddressComponent(
  result: GeocodeResult | null | undefined,
  candidateTypes: string[],
) {
  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  return (
    components.find((component) =>
      candidateTypes.some((candidateType) => component?.types?.includes(candidateType)),
    ) || null
  );
}

function extractShortLabel(result: GeocodeResult | null | undefined) {
  const cityComponent =
    findAddressComponent(result, ["locality", "postal_town"]) ||
    findAddressComponent(result, ["sublocality_level_1", "sublocality"]) ||
    findAddressComponent(result, ["administrative_area_level_2"]) ||
    findAddressComponent(result, ["neighborhood"]) ||
    findAddressComponent(result, ["administrative_area_level_1"]);

  const cityLabel = String(cityComponent?.long_name || cityComponent?.short_name || "").trim();
  if (cityLabel) {
    return cityLabel;
  }

  const route = findAddressComponent(result, ["route"]);
  const streetNumber = findAddressComponent(result, ["street_number"]);
  const streetLabel = [streetNumber?.long_name, route?.long_name].filter(Boolean).join(" ").trim();
  if (streetLabel) {
    return streetLabel;
  }

  return firstAddressSegment(result?.formatted_address) || null;
}

export const geocodeSearch = action({
  args: {
    query: v.string(),
  },
  handler: async (_ctx, args) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("Missing GOOGLE_MAPS_API_KEY for location search.");
    }

    const query = String(args.query || "").trim();
    if (!query) {
      throw new Error("Enter a location to search.");
    }

    const url = new URL(GEOCODE_ENDPOINT);
    url.searchParams.set("address", query);
    url.searchParams.set("key", apiKey);

    const payload = await fetchJson(url);
    const result = (Array.isArray(payload?.results) ? payload.results[0] : null) as GeocodeResult | null;
    if (!result?.geometry?.location) {
      throw new Error("Location not found.");
    }

    return {
      lat: Number(result.geometry.location.lat),
      lng: Number(result.geometry.location.lng),
      label: String(result.formatted_address || query),
      shortLabel: extractShortLabel(result),
      placeId: String(result.place_id || ""),
    };
  },
});

export const reverseGeocode = action({
  args: {
    lat: v.number(),
    lng: v.number(),
  },
  handler: async (_ctx, args) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("Missing GOOGLE_MAPS_API_KEY for reverse geocoding.");
    }

    const url = new URL(GEOCODE_ENDPOINT);
    url.searchParams.set("latlng", `${args.lat},${args.lng}`);
    url.searchParams.set("key", apiKey);

    const payload = await fetchJson(url);
    const result = (Array.isArray(payload?.results) ? payload.results[0] : null) as GeocodeResult | null;
    if (!result?.formatted_address) {
      throw new Error("Unable to resolve that location.");
    }

    return {
      label: String(result.formatted_address),
      shortLabel: extractShortLabel(result),
      placeId: String(result.place_id || ""),
    };
  },
});
