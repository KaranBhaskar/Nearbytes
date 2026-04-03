const request = require("supertest");
const fs = require("fs");
const os = require("os");
const path = require("path");
const app = require("./app");
const { getDb, closeDb } = require("./db");
const { seed } = require("./seed");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nearbytes-reviews-"));
process.env.DB_PATH = path.join(testRoot, "reviews.test.db");

describe("Review & Rating Module (UT-11, UT-12, IT-05)", () => {
  let customerToken;
  const restaurantId = 1; // Standard ID from seed data

  beforeAll(async () => {
    seed();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "customer@example.com", password: "Customer@123" });
    customerToken = login.body.token;
  });

  afterAll(() => {
    closeDb();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  // UT-11-CB: Successful Review Submission
  test("UT-11-CB: submitReview() should save review and trigger rating update", async () => {
    const reviewData = { rating: 4, comment: "Great food and service!" };

    const response = await request(app)
      .post(`/api/restaurants/${restaurantId}/reviews`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(reviewData)
      .expect(201);

    expect(response.body.review.rating).toBe(4);
    expect(response.body.review.comment).toBe("Great food and service!");
  });

  // UT-12-OB: Out of Range Rating (Opaque Box / Negative Path)
  test("UT-12-OB: submitReview() should reject a rating of 6", async () => {
    const invalidReview = { rating: 6, comment: "Illegal rating test" };

    const response = await request(app)
      .post(`/api/restaurants/${restaurantId}/reviews`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send(invalidReview)
      .expect(400);

    expect(response.body.error).toBe("rating must be between 1 and 5");
  });

  // IT-05-CB: Review API & DB Integration
  test("IT-05-CB: Review should be stored in DB and affect average rating", async () => {
    const db = getDb();

    // Check DB directly for the review we just posted in UT-11
    const reviewInDb = db
      .prepare(
        "SELECT * FROM reviews WHERE restaurant_id = ? AND comment LIKE ?"
      )
      .get(restaurantId, "%Great food%");

    expect(reviewInDb).toBeDefined();
    expect(reviewInDb.rating).toBe(4);

    // Verify the aggregate logic is working in the restaurant details
    const details = await request(app)
      .get(`/api/restaurants/${restaurantId}`)
      .expect(200);

    expect(details.body.restaurant.appRating).toBeDefined();
    expect(details.body.restaurant.appRatingCount).toBeGreaterThan(0);
  });
});
