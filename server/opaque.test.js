const request = require("supertest");
const fs = require("fs");
const os = require("os");
const path = require("path");
const app = require("./app");
const { closeDb } = require("./db");
const { seed } = require("./seed");

// Setup a temporary isolated test database
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nearbytes-ob-"));
process.env.DB_PATH = path.join(testRoot, "opaque.test.db");

describe("Opaque Box (Black Box) Testing", () => {
  beforeAll(() => {
    seed(); // Ensure existing users are present for negative testing
  });

  afterAll(() => {
    closeDb();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  // UT-02-OB: Registration Error Handling
  test("UT-02-OB: registerUser() should fail with email already in use", async () => {
    const existingUser = {
      name: "Duplicate User",
      email: "customer@example.com", // This email is created during seeding
      password: "NewPassword@123",
      role: "customer",
    };

    const response = await request(app)
      .post("/api/auth/signup")
      .send(existingUser)
      .expect(409);

    expect(response.body.error).toBe("email already in use");
  });

  // UT-04-OB: Login Error Handling
  test("UT-04-OB: loginUser() should fail with invalid credentials", async () => {
    const invalidLogin = {
      email: "customer@example.com",
      password: "wrong-password",
    };

    const response = await request(app)
      .post("/api/auth/login")
      .send(invalidLogin)
      .expect(401);

    expect(response.body.error).toBe("invalid credentials");
  });

  // IT-08-OB: API Validation Logic
  test("IT-08-OB: POST /api/auth/signup should reject missing fields", async () => {
    const malformedUser = {
      name: "Incomplete User",
      email: "missing-pass@example.com",
      role: "customer",
      // Password field is intentionally omitted
    };

    const response = await request(app)
      .post("/api/auth/signup")
      .send(malformedUser)
      .expect(400);

    expect(response.body.error).toContain("password");
  });
});
