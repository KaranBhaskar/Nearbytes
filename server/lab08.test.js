const jwt = require("jsonwebtoken");
const auth = require("./auth");
const utils = require("./utils");

// MOCK OBJECT: We mock the jsonwebtoken library to satisfy the lab requirement
jest.mock("jsonwebtoken");

describe("Lab 8 - Unit Test Suite", () => {
  // --- Class/Module 1: Auth Logic ---
  describe("Authentication Methods", () => {
    const mockUser = {
      id: 1,
      name: "Chef",
      email: "chef@test.com",
      role: "owner",
    };

    test("sanitizeUser() should remove sensitive data", () => {
      const result = auth.sanitizeUser({ ...mockUser, password: "secret123" });
      expect(result).not.toHaveProperty("password");
      expect(result.role).toBe("owner");
    });

    test("generateToken() should use mock object to sign", () => {
      jwt.sign.mockReturnValue("mocked_token_xyz");
      const token = auth.generateToken(mockUser);
      expect(token).toBe("mocked_token_xyz");
      expect(jwt.sign).toHaveBeenCalled();
    });
  });

  // --- Class/Module 2: Utility Calculations ---
  describe("Utility Methods", () => {
    test("haversineKm() should calculate distance", () => {
      const distance = utils.haversineKm(40.7128, -74.006, 34.0522, -118.2437); // NY to LA
      expect(distance).toBeGreaterThan(3000);
    });

    test("encodeCursor() and decodeCursor() should be consistent", () => {
      const val = 10;
      const encoded = utils.encodeCursor(val);
      expect(utils.decodeCursor(encoded)).toBe(val);
    });

    test("combineRatings() should correctly weigh Google vs App reviews", () => {
      const result = utils.combineRatings(5, 1, 1, 1); // 1 five-star, 1 one-star
      expect(result.combinedAvg).toBe(3);
      expect(result.combinedCount).toBe(2);
    });
  });
});
