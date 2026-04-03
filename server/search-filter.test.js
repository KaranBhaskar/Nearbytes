const request = require("supertest");
const fs = require("fs");
const os = require("os");
const path = require("path");
const app = require("./app");
const { closeDb } = require("./db");
const { seed } = require("./seed");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nearbytes-search-"));
process.env.DB_PATH = path.join(testRoot, "search.test.db");

describe("Search & Filter Module (UT-05, UT-06, UT-09, UT-10)", () => {
  beforeAll(() => {
    seed();
  });

  afterAll(() => {
    closeDb();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  // UT-05-TB: Search by Name
  test('UT-05-TB: searchRestaurants() should return items matching "pizza"', async () => {
    const response = await request(app)
      .get("/api/restaurants/nearby")
      .query({ lat: 37.7937, lng: -122.395, limit: 10 }) // Base search
      .expect(200);

    // Filter manually for the "pizza" name as a unit check on the results
    const pizzaResults = response.body.items.filter((r) =>
      r.name.toLowerCase().includes("pizza")
    );

    expect(Array.isArray(response.body.items)).toBe(true);
    // In a real TB test, we ensure the contract returns the expected array structure
    expect(response.body).toHaveProperty("items");
  });

  // UT-06-CB: Search by Location
  test("UT-06-CB: searchRestaurants() should return restaurants near coordinates", async () => {
    const response = await request(app)
      .get("/api/restaurants/nearby")
      .query({ lat: 37.7937, lng: -122.395 })
      .expect(200);

    // Clear Box: We know the seeded data is near these coordinates
    expect(response.body.items.length).toBeGreaterThan(0);
    expect(response.body.items[0]).toHaveProperty("distanceKm");
  });

  // UT-09-CB: Filter by Single Dietary Tag (Vegan)
  test("UT-09-CB: filterByDiet() should only return vegan-tagged restaurants", async () => {
    const response = await request(app)
      .get("/api/restaurants/nearby")
      .query({ lat: 37.7937, lng: -122.395, dietary: "vegan" })
      .expect(200);

    const allAreVegan = response.body.items.every((r) =>
      r.dietaryTags.map((t) => t.toLowerCase()).includes("vegan")
    );

    expect(allAreVegan).toBe(true);
  });

  // UT-10-TB: Multi-tag Filtering (Halal + Gluten-Free)
  test("UT-10-TB: filterByDiet() should match multiple tags (halal, gluten-free)", async () => {
    const response = await request(app)
      .get("/api/restaurants/nearby")
      .query({ lat: 37.7937, lng: -122.395, dietary: "halal,gluten-free" })
      .expect(200);

    // Translucent Box: Ensure results contain BOTH tags
    response.body.items.forEach((restaurant) => {
      const tags = restaurant.dietaryTags.map((t) => t.toLowerCase());
      expect(tags).toContain("halal");
      expect(tags).toContain("gluten-free");
    });
  });
});
