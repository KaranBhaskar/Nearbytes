"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const NOMINATIM_SEARCH_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_REVERSE_ENDPOINT = "https://nominatim.openstreetmap.org/reverse";
const APP_USER_AGENT = "Nearbytes/1.0 (OpenStreetMap location lookup)";

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  road?: string;
  house_number?: string;
  postcode?: string;
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
  osm_type?: string;
  osm_id?: number | string;
  place_id?: number | string;
  address?: NominatimAddress;
};

async function fetchJson(url: URL) {
  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
      "User-Agent": APP_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`OpenStreetMap lookup failed with status ${response.status}.`);
  }

  return response.json();
}

function firstAddressSegment(label?: string) {
  return String(label || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)[0] || null;
}

function extractShortLabel(result: NominatimResult | null | undefined) {
  const address = result?.address || {};
  const cityLabel =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.county ||
    address.state;

  if (cityLabel) {
    return String(cityLabel).trim();
  }

  const streetLabel = [address.house_number, address.road].filter(Boolean).join(" ").trim();
  if (streetLabel) {
    return streetLabel;
  }

  return firstAddressSegment(result?.display_name) || null;
}

function extractPlaceId(result: NominatimResult | null | undefined) {
  const osmType = String(result?.osm_type || "").trim();
  const osmId = String(result?.osm_id || "").trim();
  if (osmType && osmId) {
    return `osm:${osmType}:${osmId}`;
  }

  return String(result?.place_id || "");
}

export const geocodeSearch = action({
  args: {
    query: v.string(),
  },
  handler: async (_ctx, args) => {
    const query = String(args.query || "").trim();
    if (!query) {
      throw new Error("Enter a location to search.");
    }

    const url = new URL(NOMINATIM_SEARCH_ENDPOINT);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "1");

    const payload = await fetchJson(url);
    const result = (Array.isArray(payload) ? payload[0] : null) as NominatimResult | null;
    const lat = Number(result?.lat);
    const lng = Number(result?.lon);
    if (!result || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("Location not found.");
    }

    return {
      lat,
      lng,
      label: String(result.display_name || query),
      shortLabel: extractShortLabel(result),
      placeId: extractPlaceId(result),
    };
  },
});

export const reverseGeocode = action({
  args: {
    lat: v.number(),
    lng: v.number(),
  },
  handler: async (_ctx, args) => {
    const url = new URL(NOMINATIM_REVERSE_ENDPOINT);
    url.searchParams.set("lat", String(args.lat));
    url.searchParams.set("lon", String(args.lng));
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");

    const result = (await fetchJson(url)) as NominatimResult;
    const label = String(result?.display_name || "").trim();
    if (!label) {
      throw new Error("Unable to resolve that location.");
    }

    return {
      label,
      shortLabel: extractShortLabel(result),
      placeId: extractPlaceId(result),
    };
  },
});
