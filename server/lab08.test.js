const jwt = require("jsonwebtoken");
const auth = require("./auth");
const utils = require("./utils");

// MOCK OBJECT: We replace the real 'jsonwebtoken' library with a fake one (mock).
// This allows us to test our code's logic without needing real encryption keys.
jest.mock("jsonwebtoken");

describe("Lab 8 - Unit Test Suite", () => {
  // --- MODULE 1: AUTHENTICATION (Security Logic) ---
  describe("Authentication Methods", () => {
    const mockUser = {
      id: 1,
      name: "Chef",
      email: "chef@test.com",
      role: "owner",
    };

    // TEST 1: Privacy Check
    // This ensures that when we prepare user data for the frontend,
    // sensitive info like 'password' is deleted so it's never leaked.
    test("sanitizeUser() should remove sensitive data", () => {
      const result = auth.sanitizeUser({ ...mockUser, password: "secret123" });
      expect(result).not.toHaveProperty("password");
      expect(result.role).toBe("owner");
    });

    // TEST 2: Token Generation (Using the Mock)
    // This verifies that our app correctly calls the JWT library to create
    // a login token. We check that it actually uses the 'sign' function.
    test("generateToken() should use mock object to sign", () => {
      jwt.sign.mockReturnValue("mocked_token_xyz");
      const token = auth.generateToken(mockUser);
      expect(token).toBe("mocked_token_xyz");
      expect(jwt.sign).toHaveBeenCalled();
    });
  });

  // --- MODULE 2: UTILITY CALCULATIONS (Math & Data Logic) ---
  describe("Utility Methods", () => {
    // TEST 3: Geospatial Math
    // This checks the 'Haversine' formula. We give it coordinates for NY and LA
    // and ensure the calculated distance is mathematically correct (> 3000km).
    test("haversineKm() should calculate distance", () => {
      const distance = utils.haversineKm(40.7128, -74.006, 34.0522, -118.2437);
      expect(distance).toBeGreaterThan(3000);
    });

    // TEST 4: Data Consistency (Pagination)
    // This tests that our 'cursor' (used for scrolling through lists) can be
    // scrambled (encoded) and unscrambled (decoded) without changing the value.
    test("encodeCursor() and decodeCursor() should be consistent", () => {
      const val = 10;
      const encoded = utils.encodeCursor(val);
      expect(utils.decodeCursor(encoded)).toBe(val);
    });

    // TEST 5: Business Logic (Ratings)
    // This verifies our custom formula for mixing Google ratings with our own.
    // It ensures a 5-star Google review and a 1-star App review average out to 3.
    test("combineRatings() should correctly weigh Google vs App reviews", () => {
      const result = utils.combineRatings(5, 1, 1, 1);
      expect(result.combinedAvg).toBe(3);
      expect(result.combinedCount).toBe(2);
    });
  });
});
