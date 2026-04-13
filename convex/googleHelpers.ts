import { normalizeTag } from "./restaurantHelpers";

const DEFAULT_RADIUS_METERS = 5000;
const GRID_SCALE = 111320;
const GENERIC_TAGS = new Set([
  "restaurant",
  "food",
  "establishment",
  "point-of-interest",
  "store",
  "meal-takeaway",
  "meal-delivery",
]);

const GOOGLE_TYPE_TAG_MAP: Record<string, string[]> = {
  bakery: ["bakery", "pastries"],
  bagel_shop: ["bagels", "breakfast"],
  bar: ["bar", "drinks"],
  barbecue_restaurant: ["barbecue", "grill"],
  breakfast_restaurant: ["breakfast", "brunch"],
  brunch_restaurant: ["brunch", "breakfast"],
  bubble_tea_shop: ["bubble-tea", "tea"],
  cafe: ["cafe", "coffee"],
  chicken_restaurant: ["chicken"],
  chinese_restaurant: ["chinese"],
  coffee_shop: ["coffee", "cafe"],
  deli: ["deli", "sandwiches"],
  dessert_restaurant: ["dessert", "sweets"],
  dessert_shop: ["dessert", "sweets"],
  donut_shop: ["donuts", "coffee", "breakfast"],
  fast_food_restaurant: ["fast-food", "quick-bites"],
  hamburger_restaurant: ["burgers"],
  ice_cream_shop: ["ice-cream", "dessert"],
  indian_restaurant: ["indian"],
  italian_restaurant: ["italian", "pasta"],
  japanese_restaurant: ["japanese"],
  korean_restaurant: ["korean"],
  meal_delivery: ["delivery"],
  meal_takeaway: ["takeout"],
  mediterranean_restaurant: ["mediterranean"],
  mexican_restaurant: ["mexican", "tacos"],
  middle_eastern_restaurant: ["middle-eastern"],
  pho_restaurant: ["vietnamese", "pho", "noodles"],
  pizza_restaurant: ["pizza"],
  ramen_restaurant: ["ramen", "japanese", "noodles"],
  sandwich_shop: ["sandwiches", "lunch"],
  seafood_restaurant: ["seafood"],
  steak_house: ["steakhouse", "grill"],
  sushi_restaurant: ["sushi", "japanese"],
  thai_restaurant: ["thai"],
  tea_house: ["tea", "cafe"],
  vegetarian_restaurant: ["vegetarian", "vegetarian-friendly"],
  vietnamese_restaurant: ["vietnamese", "noodles"],
  wings_restaurant: ["wings", "chicken"],
};

const KEYWORD_TAG_RULES = [
  { tag: "all-day-breakfast", patterns: ["all day breakfast"] },
  { tag: "bakery", patterns: ["bakery", "baked goods", "pastries"] },
  { tag: "bagels", patterns: ["bagel", "bagels"] },
  { tag: "barbecue", patterns: ["barbecue", "bbq"] },
  { tag: "breakfast", patterns: ["breakfast"] },
  { tag: "brunch", patterns: ["brunch"] },
  { tag: "bubble-tea", patterns: ["bubble tea", "boba"] },
  { tag: "burgers", patterns: ["burger", "burgers"] },
  { tag: "cafe", patterns: ["cafe"] },
  { tag: "chicken", patterns: ["chicken"] },
  { tag: "coffee", patterns: ["coffee", "espresso"] },
  { tag: "dessert", patterns: ["dessert", "sweet treats", "sweets"] },
  { tag: "donuts", patterns: ["donut", "doughnut"] },
  { tag: "family-friendly", patterns: ["family friendly", "family-friendly"] },
  { tag: "fast-food", patterns: ["fast food", "quick service"] },
  { tag: "gluten-free-friendly", patterns: ["gluten free", "gluten-free"] },
  { tag: "halal-friendly", patterns: ["halal"] },
  { tag: "ice-cream", patterns: ["ice cream", "gelato"] },
  { tag: "late-night", patterns: ["late night", "late-night"] },
  { tag: "noodles", patterns: ["noodle", "noodles"] },
  { tag: "pastries", patterns: ["pastry", "pastries"] },
  { tag: "pizza", patterns: ["pizza"] },
  { tag: "quick-bites", patterns: ["quick bite", "quick bites"] },
  { tag: "sandwiches", patterns: ["sandwich", "sandwiches", "subs", "wraps"] },
  { tag: "tea", patterns: ["tea", "chai"] },
  { tag: "vegetarian-friendly", patterns: ["vegetarian options", "vegetarian-friendly"] },
  { tag: "vegan-friendly", patterns: ["vegan options", "vegan-friendly"] },
];

const BRAND_TAG_MAP: Array<{ patterns: string[]; tags: string[] }> = [
  {
    patterns: ["tim hortons", "tim's"],
    tags: ["coffee", "cafe", "donuts", "breakfast", "sandwiches"],
  },
  {
    patterns: ["starbucks"],
    tags: ["coffee", "cafe", "tea", "pastries"],
  },
  {
    patterns: ["mcdonald"],
    tags: ["fast-food", "burgers", "breakfast"],
  },
];

export const GOOGLE_SYNC_TTL_MS = 1000 * 60 * 60 * 24;
export const GOOGLE_MAX_RESULTS = 20;
export const GOOGLE_MIN_RESULTS = 10;
export const GOOGLE_TARGET_RESULTS = 60;
export const GOOGLE_MAX_RADIUS_METERS = 15000;
export const GOOGLE_MAX_SEARCH_CELLS = 9;
export const GEMINI_MODEL = String(process.env.GEMINI_MODEL || "gemini-2.5-flash-lite").trim();
export const OSM_MIN_RESULTS = GOOGLE_MIN_RESULTS;
export const OSM_TARGET_RESULTS = GOOGLE_TARGET_RESULTS;
export const OSM_MAX_RADIUS_METERS = 30000;

function bucketCoordinate(value: number, step: number) {
  return Number((Math.round(value / step) * step).toFixed(4));
}

export function getNearbyRadiusMeters() {
  const parsed = Number(
    process.env.NEARBY_RADIUS_METERS ||
      process.env.OSM_NEARBY_RADIUS_METERS ||
      process.env.GOOGLE_NEARBY_RADIUS_METERS ||
      DEFAULT_RADIUS_METERS,
  );
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 50000) : DEFAULT_RADIUS_METERS;
}

export function buildNearbyCacheKey(lat: number, lng: number, radiusMeters = getNearbyRadiusMeters()) {
  const degreeStep = Math.max(radiusMeters / GRID_SCALE, 0.01);
  const latBucket = bucketCoordinate(lat, degreeStep);
  const lngBucket = bucketCoordinate(lng, degreeStep);
  return `nearby:${latBucket}:${lngBucket}:${Math.round(radiusMeters)}`;
}

export function isCacheFresh(lastSyncedAt?: string | null) {
  if (!lastSyncedAt) {
    return false;
  }

  const timestamp = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  return Date.now() - timestamp < GOOGLE_SYNC_TTL_MS;
}

function normalizeTextList(values: unknown[] = []) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function slugTags(values: string[]) {
  return Array.from(new Set(values.map((value) => normalizeTag(value)).filter(Boolean)));
}

function addKeywordTags(target: Set<string>, text: string) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) {
    return;
  }

  for (const rule of KEYWORD_TAG_RULES) {
    if (rule.patterns.some((pattern) => normalized.includes(pattern))) {
      target.add(rule.tag);
    }
  }

  for (const brand of BRAND_TAG_MAP) {
    if (brand.patterns.some((pattern) => normalized.includes(pattern))) {
      for (const tag of brand.tags) {
        target.add(tag);
      }
    }
  }
}

function inferCuisineLikeTags(place: any) {
  const inferred = new Set<string>();
  const types = Array.isArray(place?.types) ? place.types : [];
  const textSources = [
    extractDisplayText(place?.displayName),
    extractDisplayText(place?.primaryTypeDisplayName),
    String(place?.primaryType || ""),
    String(place?.formattedAddress || ""),
    extractDisplayText(place?.editorialSummary),
  ];

  for (const type of types) {
    const normalizedType = normalizeTag(type);
    if (!normalizedType || GENERIC_TAGS.has(normalizedType)) {
      continue;
    }

    inferred.add(normalizedType);
    const mappedTags = GOOGLE_TYPE_TAG_MAP[type] || GOOGLE_TYPE_TAG_MAP[normalizedType];
    for (const tag of mappedTags || []) {
      inferred.add(tag);
    }
  }

  for (const source of textSources) {
    addKeywordTags(inferred, String(source || ""));
  }

  if (place?.delivery) {
    inferred.add("delivery");
  }
  if (place?.takeout) {
    inferred.add("takeout");
  }
  if (place?.dineIn) {
    inferred.add("dine-in");
  }

  return Array.from(inferred);
}

function inferFriendlyTags(values: string[]) {
  const tags = new Set<string>();
  const normalized = values.map((value) => normalizeTag(value)).filter(Boolean);

  const hasAny = (candidates: string[]) => candidates.some((candidate) => normalized.includes(candidate));

  if (
    hasAny([
      "bakery",
      "breakfast",
      "brunch",
      "burgers",
      "cafe",
      "coffee",
      "dessert",
      "donuts",
      "fast-food",
      "pastries",
      "pizza",
      "quick-bites",
      "sandwiches",
      "tea",
    ])
  ) {
    tags.add("vegetarian-friendly");
  }

  if (
    hasAny([
      "chinese",
      "hot-pot",
      "indian",
      "japanese",
      "korean",
      "mediterranean",
      "mexican",
      "middle-eastern",
      "seafood",
      "sushi",
      "thai",
      "vietnamese",
      "noodles",
      "salads",
      "poke",
    ])
  ) {
    tags.add("gluten-free-friendly");
  }

  if (hasAny(["middle-eastern", "indian", "pakistani", "shawarma"])) {
    tags.add("halal-friendly");
  }

  return Array.from(tags);
}

export function extractDisplayText(value: any) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (typeof value?.text === "string") {
    return value.text.trim() || null;
  }

  return null;
}

export function extractOpeningHours(place: any) {
  const descriptions = place?.regularOpeningHours?.weekdayDescriptions;
  if (Array.isArray(descriptions) && descriptions.length) {
    return descriptions.join(" | ");
  }

  return null;
}

export function extractCuisineTags(place: any, geminiCuisineTags: string[] = []) {
  const seedValues = normalizeTextList([
    extractDisplayText(place?.primaryTypeDisplayName),
    ...(Array.isArray(place?.types) ? place.types : []),
    ...inferCuisineLikeTags(place),
    ...geminiCuisineTags,
  ]);

  const values = normalizeTextList([
    ...seedValues,
    ...inferFriendlyTags(seedValues),
  ]);

  return slugTags(values).filter((tag) => !GENERIC_TAGS.has(tag));
}

export function extractDietaryTags(place: any, geminiDietaryTags: string[] = []) {
  const inferred = [...geminiDietaryTags];
  if (place?.servesVegetarianFood) {
    inferred.push("vegetarian");
  }

  return slugTags(inferred);
}

export function sanitizeMenuItems(items: any[] = []) {
  return items
    .map((item) => ({
      name: String(item?.name || "").trim(),
      description: String(item?.description || "").trim() || null,
      price: Number(item?.price || 0),
      imageUrl: null,
    }))
    .filter((item) => item.name)
    .slice(0, 6)
    .map((item) => ({
      ...item,
      price: Number.isFinite(item.price) && item.price > 0 ? Number(item.price.toFixed(2)) : 0,
    }));
}

export function shouldUseGemini(place: any) {
  const hasEditorialSummary = Boolean(extractDisplayText(place?.editorialSummary));
  const inferredCuisineTags = extractCuisineTags(place);
  const inferredDietaryTags = extractDietaryTags(place);
  const hasMenuSignals = inferredCuisineTags.some((tag) =>
    [
      "bakery",
      "breakfast",
      "brunch",
      "burgers",
      "coffee",
      "dessert",
      "donuts",
      "pizza",
      "sandwiches",
      "sushi",
      "tacos",
    ].includes(tag),
  );

  return !hasEditorialSummary || inferredCuisineTags.length < 4 || inferredDietaryTags.length < 1 || !hasMenuSignals;
}
