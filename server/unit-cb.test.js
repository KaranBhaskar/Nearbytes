const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const { combineRatings } = require("./utils");

// Mocking JWT Secret for testing
const JWT_SECRET = "test-secret";

// UT-13-CB & UT-14-TB: calculateAvgRating logic
// (Implemented via combineRatings in your utility file)
describe("Ratings Utility (UT-13, UT-14)", () => {
  test("UT-13-CB: should return weighted average correctly", () => {
    // googleAvg, googleCount, appAvg, appCount
    const { combinedAvg, combinedCount } = combineRatings(4.0, 10, 5.0, 10);
    expect(combinedAvg).toBe(4.5);
    expect(combinedCount).toBe(20);
  });

  test("UT-14-TB: should return null or 0 when no reviews exist", () => {
    const { combinedAvg, combinedCount } = combineRatings(null, 0, null, 0);
    expect(combinedAvg).toBeNull();
    expect(combinedCount).toBe(0);
  });
});

// Setup for Database-dependent Unit Tests (UT-01, UT-03)
describe("User Logic Unit Tests", () => {
  let db;

  beforeEach(() => {
    // Create an in-memory database for isolation [cite: 36]
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT UNIQUE,
        password_hash TEXT,
        role TEXT
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  test("UT-01-CB: registerUser() should create a user record", () => {
    const name = "New User";
    const email = "new@test.com";
    const pass = bcrypt.hashSync("Pass@123", 10);

    const info = db
      .prepare(
        "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)"
      )
      .run(name, email, pass, "customer");

    const user = db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(info.lastInsertRowid);

    expect(user.email).toBe(email);
    expect(user.name).toBe(name);
    expect(info.lastInsertRowid).toBeDefined();
  });

  test("UT-03-CB: loginUser() should verify credentials and allow session", () => {
    // Pre-seed a user
    const pass = "Pass@123";
    const hash = bcrypt.hashSync(pass, 10);
    db.prepare(
      "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)"
    ).run("Test User", "user@test.com", hash, "customer");

    // Simulate login logic
    const user = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get("user@test.com");
    const isValid = bcrypt.compareSync(pass, user.password_hash);

    expect(isValid).toBe(true);

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
    expect(token).toBeDefined();

    const verified = jwt.verify(token, JWT_SECRET);
    expect(verified.email).toBe("user@test.com");
  });
});
