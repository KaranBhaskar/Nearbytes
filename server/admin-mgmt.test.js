const request = require("supertest");
const fs = require("fs");
const os = require("os");
const path = require("path");
const app = require("./app");
const { closeDb } = require("./db");
const { seed } = require("./seed");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nearbytes-admin-"));
process.env.DB_PATH = path.join(testRoot, "admin.test.db");

describe("Admin & Owner Management (UT-07, UT-08, UT-15)", () => {
  let ownerToken;
  let customerToken;

  beforeAll(async () => {
    seed();

    // Login as owner to get a valid token
    const ownerLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "owner@example.com", password: "Owner@123" });
    ownerToken = ownerLogin.body.token;

    // Login as customer to test unauthorized access
    const customerLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "customer@example.com", password: "Customer@123" });
    customerToken = customerLogin.body.token;
  });

  afterAll(() => {
    closeDb();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  // UT-07-CB: Add Restaurant (Authorized)
  test("UT-07-CB: addRestaurant() should allow owner to create a record", async () => {
    const newRestaurant = {
      name: "Test Kitchen",
      address: "123 Quality Lane",
      lat: 43.945,
      lng: -78.896,
      cuisineTags: "Testing",
      dietaryTags: "vegan",
    };

    const response = await request(app)
      .post("/api/owner/restaurants")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(newRestaurant)
      .expect(201);

    expect(response.body.restaurant.name).toBe("Test Kitchen");
    expect(response.body.restaurant.ownerId).toBeDefined();
  });

  // UT-08-OB: Add Restaurant (Unauthorized)
  test("UT-08-OB: addRestaurant() should reject non-owner tokens", async () => {
    const response = await request(app)
      .post("/api/owner/restaurants")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ name: "Hack Attack", address: "Unknown", lat: 0, lng: 0 })
      .expect(403);

    expect(response.body.error).toBe("Insufficient permission");
  });

  // UT-15-CB: Update Restaurant
  test("UT-15-CB: updateRestaurant() should modify existing record in DB", async () => {
    // Get an existing restaurant owned by this owner
    const listResponse = await request(app)
      .get("/api/owner/restaurants")
      .set("Authorization", `Bearer ${ownerToken}`);

    const targetId = listResponse.body.restaurants[0].id;

    const updateData = {
      name: "Updated Name",
      address: "456 New Road",
      lat: 43.945,
      lng: -78.896,
    };

    const response = await request(app)
      .put(`/api/owner/restaurants/${targetId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(updateData)
      .expect(200);

    expect(response.body.restaurant.name).toBe("Updated Name");
  });
});
