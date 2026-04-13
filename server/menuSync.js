const cheerio = require("cheerio");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toAbsoluteUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function looksLikeMenuUrl(url) {
  const value = String(url || "").toLowerCase();
  return (
    value.includes("/menu") ||
    value.includes("menu.") ||
    value.includes("menus") ||
    value.includes("food-menu")
  );
}

function findCandidateMenuUrls(website, html) {
  const urls = new Set();
  if (website) urls.add(website);

  const $ = cheerio.load(html);

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    const abs = toAbsoluteUrl(website, href);
    if (abs && looksLikeMenuUrl(abs)) {
      urls.add(abs);
    }
  });

  return Array.from(urls);
}

function extractPrice(text) {
  const match = String(text || "").match(/\$?\s?(\d+(?:\.\d{1,2})?)/);
  return match ? Number(match[1]) : null;
}

function extractMenuItemsFromJsonLd(html) {
  const $ = cheerio.load(html);
  const results = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];

      const walk = (node) => {
        if (!node || typeof node !== "object") return;

        const type = Array.isArray(node["@type"])
          ? node["@type"].join(",")
          : String(node["@type"] || "");

        if (type.includes("MenuItem")) {
          const name = normalizeText(node.name);
          const description = normalizeText(node.description);
          const price =
            node.offers && typeof node.offers === "object"
              ? Number(node.offers.price || 0)
              : extractPrice(node.price);

          if (name) {
            results.push({
              name,
              description: description || null,
              price: Number.isFinite(price) ? price : 0,
            });
          }
        }

        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            value.forEach(walk);
          } else if (value && typeof value === "object") {
            walk(value);
          }
        }
      };

      nodes.forEach(walk);
    } catch {
      // ignore malformed JSON-LD
    }
  });

  return results;
}

function extractMenuItemsFromHtml(html) {
  const $ = cheerio.load(html);
  const results = [];

  const selectors = [
    ".menu-item",
    ".menuItem",
    ".food-item",
    ".product",
    ".dish",
    "[data-menu-item]",
    ".menu li",
    ".menu-entry",
  ];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const root = $(el);

      const name =
        normalizeText(root.find("h1,h2,h3,h4,.name,.title,.item-name").first().text()) ||
        normalizeText(root.contents().first().text());

      const description = normalizeText(
        root.find("p,.description,.desc,.item-description").first().text()
      );

      const priceText = normalizeText(
        root.find(".price,[class*=price],.amount").first().text() || root.text()
      );

      const price = extractPrice(priceText);

      if (name && name.length >= 2) {
        results.push({
          name,
          description: description || null,
          price: Number.isFinite(price) ? price : 0,
        });
      }
    });

    if (results.length >= 3) break;
  }

  return results;
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${String(item.name).toLowerCase()}|${Number(item.price || 0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 NearBytesMenuBot/1.0",
      Accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

async function syncRestaurantMenu(db, restaurant) {
  if (!restaurant || !restaurant.website) {
    return { imported: 0, reason: "no_website" };
  }

  const existingCount = db
    .prepare("SELECT COUNT(*) AS count FROM menu_items WHERE restaurant_id = ?")
    .get(restaurant.id).count;

  if (existingCount > 0) {
    return { imported: 0, reason: "already_present" };
  }

  const homeHtml = await fetchHtml(restaurant.website);
  const candidateUrls = findCandidateMenuUrls(restaurant.website, homeHtml);

  let allItems = [];

  for (const url of candidateUrls) {
    try {
      const html = url === restaurant.website ? homeHtml : await fetchHtml(url);

      const jsonLdItems = extractMenuItemsFromJsonLd(html);
      const htmlItems = jsonLdItems.length ? [] : extractMenuItemsFromHtml(html);

      const items = dedupeItems([...jsonLdItems, ...htmlItems]).slice(0, 30);
      if (items.length) {
        allItems = items;
        break;
      }
    } catch {
      // try next candidate
    }
  }

  if (!allItems.length) {
    return { imported: 0, reason: "no_menu_found" };
  }

  const insert = db.prepare(
    `INSERT INTO menu_items (restaurant_id, name, description, price, image_url)
     VALUES (?, ?, ?, ?, ?)`
  );

  const tx = db.transaction((items) => {
    for (const item of items) {
      insert.run(
        restaurant.id,
        item.name,
        item.description || null,
        Number.isFinite(item.price) ? item.price : 0,
        null
      );
    }
  });

  tx(allItems);

  return { imported: allItems.length, reason: "ok" };
}

module.exports = { syncRestaurantMenu };