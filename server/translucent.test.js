const request = require("supertest");
const fs = require("fs");
const os = require("os");
const path = require("path");
const app = require("./app");
const { getDb, closeDb } = require("./db");
const { seed } = require("./seed");

// Setup a temporary isolated test database
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nearbytes-it-"));
process.env.DB_PATH = path.join(testRoot, "translucent.test.db");

describe("Translucent Box Integration Tests", () => {
  beforeAll(() => {
    seed(); // Seed with initial data for IT-03
  });

  afterAll(() => {
    closeDb();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  // IT-01-TB: Auth API & Users DB Interaction
  test("IT-01-TB: POST /api/auth/signup should create a user row in the DB", async () => {
    const newUser = {
      name: "Translucent User",
      email: `tb-${Date.now()}@example.com`,
      password: "Password@123",
      role: "customer",
    };

    const response = await request(app)
      .post("/api/auth/signup")
      .send(newUser)
      .expect(201);

    // Translucent Check: Verify DB state directly
    const db = getDb();
    const userInDb = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(newUser.email);

    expect(userInDb).toBeDefined();
    expect(userInDb.name).toBe(newUser.name);
    expect(response.body.user.email).toBe(newUser.email);
  });

  // IT-03-TB: Search API & DB Interaction
  test("IT-03-TB: GET /api/restaurants/nearby should return records from DB", async () => {
    const response = await request(app)
      .get("/api/restaurants/nearby")
      .query({ lat: 37.7937, lng: -122.395 })
      .expect(200);

    expect(Array.isArray(response.body.items)).toBe(true);
    expect(response.body.items.length).toBeGreaterThan(0);

    const firstItem = response.body.items[0];
    expect(firstItem).toHaveProperty("name");
    expect(firstItem).toHaveProperty("combinedRating");
  });
});
