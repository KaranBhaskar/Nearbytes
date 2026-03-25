const request = require("supertest");
const app = require("./server/app"); // Fixed path to reach into the server folder

describe("TDD Demo: Search by Dish Name", () => {
  it('should return 200 and items matching "Burger"', async () => {
    // This will hit /api/dishes/search
    const response = await request(app).get("/api/dishes/search?q=Burger");

    // In the RED phase, this expects a 200 but will get a 404
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
  });
});
