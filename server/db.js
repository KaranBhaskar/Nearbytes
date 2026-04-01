const path = require('path');
const Database = require('better-sqlite3');

let db;

function getDbPath() {
  return process.env.DB_PATH || path.join(process.cwd(), 'app.db');
}

function migrate(database) {
  database.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('customer', 'owner', 'moderator')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS restaurants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      description TEXT,
      phone TEXT,
      website TEXT,
      opening_hours TEXT,
      cuisine_tags TEXT,
      dietary_tags TEXT,
      google_place_id TEXT UNIQUE,
      google_rating REAL,
      google_rating_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS restaurant_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      is_cover INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      image_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restaurant_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(restaurant_id, user_id),
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_restaurants_lat_lng ON restaurants(lat, lng);
    CREATE INDEX IF NOT EXISTS idx_reviews_restaurant_id ON reviews(restaurant_id);
    CREATE INDEX IF NOT EXISTS idx_images_restaurant_id ON restaurant_images(restaurant_id);
    CREATE INDEX IF NOT EXISTS idx_menu_restaurant_id ON menu_items(restaurant_id);
  `);

  const usersTableSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get();
  if (
    usersTableSql &&
    usersTableSql.sql &&
    !String(usersTableSql.sql).includes("'moderator'")
  ) {
    database.exec(`
      ALTER TABLE users RENAME TO users_old;

      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('customer', 'owner', 'moderator')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users(id, name, email, password_hash, role, created_at, updated_at)
      SELECT id, name, email, password_hash, role, created_at, updated_at
      FROM users_old;

      DROP TABLE users_old;
    `);
  }

  const restaurantColumns = database.prepare("PRAGMA table_info(restaurants)").all();
  if (!restaurantColumns.some((column) => column.name === 'dietary_tags')) {
    database.exec('ALTER TABLE restaurants ADD COLUMN dietary_tags TEXT');
  }
  if (!restaurantColumns.some((column) => column.name === 'opening_hours')) {
    database.exec('ALTER TABLE restaurants ADD COLUMN opening_hours TEXT');
  }
  if (!restaurantColumns.some((column) => column.name === 'google_photo_ref')) {
    database.exec('ALTER TABLE restaurants ADD COLUMN google_photo_ref TEXT');
  }
}

function getDb() {
  if (db) return db;

  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function closeDb() {
  if (!db) return;

  db.close();
  db = null;
}

module.exports = {
  closeDb,
  getDb,
  getDbPath,
};
