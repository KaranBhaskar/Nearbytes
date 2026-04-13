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
      is_banned INTEGER NOT NULL DEFAULT 0,
      banned_at TEXT,
      banned_reason TEXT,
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
      menu_url TEXT,
      cuisine_tags TEXT,
      dietary_tags TEXT,
      google_place_id TEXT UNIQUE,
      google_rating REAL,
      google_rating_count INTEGER NOT NULL DEFAULT 0,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      hidden_reason TEXT,
      hidden_at TEXT,
      hidden_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (hidden_by_user_id) REFERENCES users(id) ON DELETE SET NULL
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

    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      restaurant_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, restaurant_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS search_states (
      user_id INTEGER PRIMARY KEY,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      label TEXT NOT NULL,
      short_label TEXT,
      radius_meters INTEGER NOT NULL DEFAULT 5000,
      loaded_count INTEGER NOT NULL DEFAULT 0,
      dietary_filters TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
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
  const userColumns = database.prepare("PRAGMA table_info(users)").all();
  if (!userColumns.some((column) => column.name === 'is_banned')) {
    database.exec('ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0');
  }
  if (!userColumns.some((column) => column.name === 'banned_at')) {
    database.exec('ALTER TABLE users ADD COLUMN banned_at TEXT');
  }
  if (!userColumns.some((column) => column.name === 'banned_reason')) {
    database.exec('ALTER TABLE users ADD COLUMN banned_reason TEXT');
  }
  if (!restaurantColumns.some((column) => column.name === 'dietary_tags')) {
    database.exec('ALTER TABLE restaurants ADD COLUMN dietary_tags TEXT');
  }
  if (!restaurantColumns.some((column) => column.name === 'opening_hours')) {
    database.exec('ALTER TABLE restaurants ADD COLUMN opening_hours TEXT');
  }
  if (!restaurantColumns.some((column) => column.name === 'menu_url')) {
    database.exec('ALTER TABLE restaurants ADD COLUMN menu_url TEXT');
  }
  if (!restaurantColumns.some((column) => column.name === 'google_photo_ref')) {
    database.exec('ALTER TABLE restaurants ADD COLUMN google_photo_ref TEXT');
  }
  if (!restaurantColumns.some((column) => column.name === 'is_hidden')) {
    database.exec('ALTER TABLE restaurants ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0');
  }
  if (!restaurantColumns.some((column) => column.name === 'hidden_reason')) {
    database.exec('ALTER TABLE restaurants ADD COLUMN hidden_reason TEXT');
  }
  if (!restaurantColumns.some((column) => column.name === 'hidden_at')) {
    database.exec('ALTER TABLE restaurants ADD COLUMN hidden_at TEXT');
  }
  if (!restaurantColumns.some((column) => column.name === 'hidden_by_user_id')) {
    database.exec('ALTER TABLE restaurants ADD COLUMN hidden_by_user_id INTEGER');
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
