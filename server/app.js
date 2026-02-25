require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { getDb } = require('./db');
const { syncGoogleNearby } = require('./googlePlaces');
const {
  generateToken,
  sanitizeUser,
  optionalAuth,
  requireAuth,
  requireRole,
} = require('./auth');
const { haversineKm, encodeCursor, decodeCursor, combineRatings } = require('./utils');

const app = express();
const db = getDb();

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image uploads are allowed'));
    }

    return cb(null, true);
  },
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.join(process.cwd(), 'public')));

function parseCuisineTags(value) {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return String(value)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function normalizeRestaurantRow(row) {
  const appAvg = row.app_avg == null ? null : Number(row.app_avg);
  const appCount = Number(row.app_count || 0);
  const googleAvg = row.google_rating == null ? null : Number(row.google_rating);
  const googleCount = Number(row.google_rating_count || 0);
  const { combinedAvg, combinedCount } = combineRatings(googleAvg, googleCount, appAvg, appCount);

  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    description: row.description,
    phone: row.phone,
    website: row.website,
    cuisineTags: parseCuisineTags(row.cuisine_tags),
    googlePlaceId: row.google_place_id,
    coverImage: row.cover_image || null,
    googleRating: googleAvg,
    googleRatingCount: googleCount,
    appRating: appAvg,
    appRatingCount: appCount,
    combinedRating: combinedAvg,
    combinedRatingCount: combinedCount,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRestaurantWithAggregates(restaurantId) {
  const row = db
    .prepare(
      `
      SELECT
        r.*,
        img.url AS cover_image,
        app.avg_rating AS app_avg,
        app.review_count AS app_count
      FROM restaurants r
      LEFT JOIN (
        SELECT restaurant_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
        FROM reviews
        GROUP BY restaurant_id
      ) app ON app.restaurant_id = r.id
      LEFT JOIN restaurant_images img
        ON img.restaurant_id = r.id AND img.is_cover = 1
      WHERE r.id = ?
    `
    )
    .get(restaurantId);

  return row ? normalizeRestaurantRow(row) : null;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/auth/signup', (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password, and role are required' });
  }

  if (!['customer', 'owner'].includes(role)) {
    return res.status(400).json({ error: 'role must be customer or owner' });
  }

  if (String(password).length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) {
    return res.status(409).json({ error: 'email already in use' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users(name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), normalizedEmail, passwordHash, role);

  const user = db.prepare('SELECT id, name, email, role FROM users WHERE id = ?').get(info.lastInsertRowid);
  const token = generateToken(user);

  return res.status(201).json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const token = generateToken(user);
  return res.json({ token, user: sanitizeUser(user) });
});

app.post('/api/auth/logout', (_req, res) => {
  return res.json({ ok: true });
});

app.get('/api/restaurants/nearby', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng query params are required numbers' });
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
  const offset = decodeCursor(req.query.cursor);

  try {
    await syncGoogleNearby(db, lat, lng);
  } catch (err) {
    // Continue with local data if Google sync fails.
    // eslint-disable-next-line no-console
    console.warn('Google sync failed:', err.message);
  }

  const rows = db
    .prepare(
      `
      SELECT
        r.*,
        img.url AS cover_image,
        app.avg_rating AS app_avg,
        app.review_count AS app_count
      FROM restaurants r
      LEFT JOIN (
        SELECT restaurant_id, AVG(rating) AS avg_rating, COUNT(*) AS review_count
        FROM reviews
        GROUP BY restaurant_id
      ) app ON app.restaurant_id = r.id
      LEFT JOIN restaurant_images img
        ON img.restaurant_id = r.id AND img.is_cover = 1
      ORDER BY r.id ASC
    `
    )
    .all();

  const withDistance = rows
    .map((row) => {
      const normalized = normalizeRestaurantRow(row);
      return {
        ...normalized,
        distanceKm: haversineKm(lat, lng, normalized.lat, normalized.lng),
      };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);

  const items = withDistance.slice(offset, offset + limit);
  const nextOffset = offset + items.length;
  const hasMore = nextOffset < withDistance.length;

  return res.json({
    items,
    hasMore,
    nextCursor: hasMore ? encodeCursor(nextOffset) : null,
    total: withDistance.length,
  });
});

app.get('/api/restaurants/:id', optionalAuth, (req, res) => {
  const restaurantId = Number(req.params.id);
  if (!Number.isFinite(restaurantId)) {
    return res.status(400).json({ error: 'invalid restaurant id' });
  }

  const restaurant = getRestaurantWithAggregates(restaurantId);
  if (!restaurant) {
    return res.status(404).json({ error: 'restaurant not found' });
  }

  const images = db
    .prepare(
      'SELECT id, url, is_cover AS isCover, created_at AS createdAt FROM restaurant_images WHERE restaurant_id = ? ORDER BY is_cover DESC, id DESC'
    )
    .all(restaurantId);

  const menuItems = db
    .prepare(
      `
      SELECT
        id,
        name,
        description,
        price,
        image_url AS imageUrl,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM menu_items
      WHERE restaurant_id = ?
      ORDER BY id DESC
    `
    )
    .all(restaurantId);

  const myReview = req.user
    ? db
        .prepare(
          `
          SELECT id, rating, comment, created_at AS createdAt, updated_at AS updatedAt
          FROM reviews
          WHERE restaurant_id = ? AND user_id = ?
        `
        )
        .get(restaurantId, req.user.id)
    : null;

  return res.json({
    restaurant,
    images,
    menuItems,
    myReview,
  });
});

app.get('/api/restaurants/:id/reviews', (req, res) => {
  const restaurantId = Number(req.params.id);
  if (!Number.isFinite(restaurantId)) {
    return res.status(400).json({ error: 'invalid restaurant id' });
  }

  const reviews = db
    .prepare(
      `
      SELECT
        r.id,
        r.rating,
        r.comment,
        r.created_at AS createdAt,
        r.updated_at AS updatedAt,
        u.id AS userId,
        u.name AS userName
      FROM reviews r
      INNER JOIN users u ON u.id = r.user_id
      WHERE r.restaurant_id = ?
      ORDER BY r.created_at DESC
    `
    )
    .all(restaurantId);

  return res.json({ reviews });
});

app.post('/api/restaurants/:id/reviews', requireAuth, requireRole('customer'), (req, res) => {
  const restaurantId = Number(req.params.id);
  const rating = Number(req.body.rating);
  const comment = req.body.comment == null ? null : String(req.body.comment).trim();

  if (!Number.isFinite(restaurantId)) {
    return res.status(400).json({ error: 'invalid restaurant id' });
  }

  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be between 1 and 5' });
  }

  const exists = db.prepare('SELECT id FROM restaurants WHERE id = ?').get(restaurantId);
  if (!exists) {
    return res.status(404).json({ error: 'restaurant not found' });
  }

  db.prepare(
    `
    INSERT INTO reviews(restaurant_id, user_id, rating, comment)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(restaurant_id, user_id)
    DO UPDATE SET
      rating = excluded.rating,
      comment = excluded.comment,
      updated_at = CURRENT_TIMESTAMP
  `
  ).run(restaurantId, req.user.id, Math.round(rating), comment);

  const review = db
    .prepare(
      `
      SELECT id, rating, comment, created_at AS createdAt, updated_at AS updatedAt
      FROM reviews
      WHERE restaurant_id = ? AND user_id = ?
    `
    )
    .get(restaurantId, req.user.id);

  return res.status(201).json({ review });
});

app.put('/api/restaurants/:id/reviews/:reviewId', requireAuth, requireRole('customer'), (req, res) => {
  const restaurantId = Number(req.params.id);
  const reviewId = Number(req.params.reviewId);
  const rating = Number(req.body.rating);
  const comment = req.body.comment == null ? null : String(req.body.comment).trim();

  if (!Number.isFinite(restaurantId) || !Number.isFinite(reviewId)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'rating must be between 1 and 5' });
  }

  const review = db
    .prepare('SELECT * FROM reviews WHERE id = ? AND restaurant_id = ?')
    .get(reviewId, restaurantId);

  if (!review) {
    return res.status(404).json({ error: 'review not found' });
  }

  if (review.user_id !== req.user.id) {
    return res.status(403).json({ error: 'you can only edit your own review' });
  }

  db.prepare('UPDATE reviews SET rating = ?, comment = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    Math.round(rating),
    comment,
    reviewId
  );

  const updated = db
    .prepare(
      'SELECT id, rating, comment, created_at AS createdAt, updated_at AS updatedAt FROM reviews WHERE id = ?'
    )
    .get(reviewId);

  return res.json({ review: updated });
});

app.delete('/api/restaurants/:id/reviews/:reviewId', requireAuth, requireRole('customer'), (req, res) => {
  const restaurantId = Number(req.params.id);
  const reviewId = Number(req.params.reviewId);

  if (!Number.isFinite(restaurantId) || !Number.isFinite(reviewId)) {
    return res.status(400).json({ error: 'invalid id' });
  }

  const review = db
    .prepare('SELECT * FROM reviews WHERE id = ? AND restaurant_id = ?')
    .get(reviewId, restaurantId);

  if (!review) {
    return res.status(404).json({ error: 'review not found' });
  }

  if (review.user_id !== req.user.id) {
    return res.status(403).json({ error: 'you can only delete your own review' });
  }

  db.prepare('DELETE FROM reviews WHERE id = ?').run(reviewId);
  return res.json({ ok: true });
});

app.get('/api/owner/restaurants', requireAuth, requireRole('owner'), (req, res) => {
  const restaurants = db
    .prepare(
      `
      SELECT
        r.id,
        r.name,
        r.address,
        r.created_at AS createdAt,
        COUNT(DISTINCT m.id) AS menuItemCount,
        COUNT(DISTINCT i.id) AS imageCount
      FROM restaurants r
      LEFT JOIN menu_items m ON m.restaurant_id = r.id
      LEFT JOIN restaurant_images i ON i.restaurant_id = r.id
      WHERE r.owner_id = ?
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `
    )
    .all(req.user.id);

  return res.json({ restaurants });
});

app.post('/api/owner/restaurants', requireAuth, requireRole('owner'), (req, res) => {
  const { name, address, lat, lng, description, phone, website, cuisineTags } = req.body;

  if (!name || !address || lat == null || lng == null) {
    return res.status(400).json({ error: 'name, address, lat and lng are required' });
  }

  const parsedLat = Number(lat);
  const parsedLng = Number(lng);
  if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) {
    return res.status(400).json({ error: 'lat and lng must be numbers' });
  }

  const tags = Array.isArray(cuisineTags)
    ? cuisineTags
    : String(cuisineTags || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  const info = db
    .prepare(
      `
      INSERT INTO restaurants(
        owner_id, name, address, lat, lng, description, phone, website, cuisine_tags,
        google_place_id, google_rating, google_rating_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    )
    .run(
      req.user.id,
      String(name).trim(),
      String(address).trim(),
      parsedLat,
      parsedLng,
      description ? String(description).trim() : null,
      phone ? String(phone).trim() : null,
      website ? String(website).trim() : null,
      JSON.stringify(tags),
      null,
      null,
      0
    );

  const restaurant = getRestaurantWithAggregates(info.lastInsertRowid);
  return res.status(201).json({ restaurant });
});

app.put('/api/owner/restaurants/:id', requireAuth, requireRole('owner'), (req, res) => {
  const restaurantId = Number(req.params.id);
  if (!Number.isFinite(restaurantId)) {
    return res.status(400).json({ error: 'invalid restaurant id' });
  }

  const existing = db
    .prepare('SELECT * FROM restaurants WHERE id = ? AND owner_id = ?')
    .get(restaurantId, req.user.id);

  if (!existing) {
    return res.status(404).json({ error: 'owned restaurant not found' });
  }

  const { name, address, lat, lng, description, phone, website, cuisineTags } = req.body;
  const nextLat = lat == null ? existing.lat : Number(lat);
  const nextLng = lng == null ? existing.lng : Number(lng);

  if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
    return res.status(400).json({ error: 'lat and lng must be valid numbers' });
  }

  const tags = Array.isArray(cuisineTags)
    ? cuisineTags
    : String(cuisineTags || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

  db.prepare(
    `
    UPDATE restaurants
    SET
      name = ?,
      address = ?,
      lat = ?,
      lng = ?,
      description = ?,
      phone = ?,
      website = ?,
      cuisine_tags = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(
    name ? String(name).trim() : existing.name,
    address ? String(address).trim() : existing.address,
    nextLat,
    nextLng,
    description == null ? existing.description : String(description).trim(),
    phone == null ? existing.phone : String(phone).trim(),
    website == null ? existing.website : String(website).trim(),
    JSON.stringify(tags.length ? tags : parseCuisineTags(existing.cuisine_tags)),
    restaurantId
  );

  const restaurant = getRestaurantWithAggregates(restaurantId);
  return res.json({ restaurant });
});

app.delete('/api/owner/restaurants/:id', requireAuth, requireRole('owner'), (req, res) => {
  const restaurantId = Number(req.params.id);
  if (!Number.isFinite(restaurantId)) {
    return res.status(400).json({ error: 'invalid restaurant id' });
  }

  const existing = db
    .prepare('SELECT id FROM restaurants WHERE id = ? AND owner_id = ?')
    .get(restaurantId, req.user.id);

  if (!existing) {
    return res.status(404).json({ error: 'owned restaurant not found' });
  }

  db.prepare('DELETE FROM restaurants WHERE id = ?').run(restaurantId);
  return res.json({ ok: true });
});

app.post(
  '/api/owner/restaurants/:id/images',
  requireAuth,
  requireRole('owner'),
  upload.array('images', 10),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    if (!Number.isFinite(restaurantId)) {
      return res.status(400).json({ error: 'invalid restaurant id' });
    }

    const existing = db
      .prepare('SELECT id FROM restaurants WHERE id = ? AND owner_id = ?')
      .get(restaurantId, req.user.id);

    if (!existing) {
      return res.status(404).json({ error: 'owned restaurant not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'at least one image file is required' });
    }

    const hasCover = db
      .prepare('SELECT id FROM restaurant_images WHERE restaurant_id = ? AND is_cover = 1')
      .get(restaurantId);

    const insert = db.prepare(
      'INSERT INTO restaurant_images(restaurant_id, url, is_cover) VALUES (?, ?, ?)'
    );

    const inserted = [];
    req.files.forEach((file, index) => {
      const isCover = !hasCover && index === 0 ? 1 : 0;
      const url = `/uploads/${file.filename}`;
      const info = insert.run(restaurantId, url, isCover);
      inserted.push({ id: info.lastInsertRowid, url, isCover: Boolean(isCover) });
    });

    return res.status(201).json({ images: inserted });
  }
);

app.post(
  '/api/owner/restaurants/:id/menu-items',
  requireAuth,
  requireRole('owner'),
  upload.single('image'),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    if (!Number.isFinite(restaurantId)) {
      return res.status(400).json({ error: 'invalid restaurant id' });
    }

    const owned = db
      .prepare('SELECT id FROM restaurants WHERE id = ? AND owner_id = ?')
      .get(restaurantId, req.user.id);

    if (!owned) {
      return res.status(404).json({ error: 'owned restaurant not found' });
    }

    const { name, description, price } = req.body;
    const parsedPrice = Number(price);

    if (!name || !Number.isFinite(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ error: 'name and non-negative price are required' });
    }

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const info = db
      .prepare(
        'INSERT INTO menu_items(restaurant_id, name, description, price, image_url) VALUES (?, ?, ?, ?, ?)'
      )
      .run(
        restaurantId,
        String(name).trim(),
        description ? String(description).trim() : null,
        parsedPrice,
        imageUrl
      );

    const item = db
      .prepare(
        'SELECT id, name, description, price, image_url AS imageUrl, created_at AS createdAt, updated_at AS updatedAt FROM menu_items WHERE id = ?'
      )
      .get(info.lastInsertRowid);

    return res.status(201).json({ item });
  }
);

app.put(
  '/api/owner/restaurants/:id/menu-items/:itemId',
  requireAuth,
  requireRole('owner'),
  upload.single('image'),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    const itemId = Number(req.params.itemId);

    if (!Number.isFinite(restaurantId) || !Number.isFinite(itemId)) {
      return res.status(400).json({ error: 'invalid ids' });
    }

    const owned = db
      .prepare('SELECT id FROM restaurants WHERE id = ? AND owner_id = ?')
      .get(restaurantId, req.user.id);

    if (!owned) {
      return res.status(404).json({ error: 'owned restaurant not found' });
    }

    const existingItem = db
      .prepare('SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?')
      .get(itemId, restaurantId);

    if (!existingItem) {
      return res.status(404).json({ error: 'menu item not found' });
    }

    const nextName = req.body.name ? String(req.body.name).trim() : existingItem.name;
    const nextDescription =
      req.body.description == null ? existingItem.description : String(req.body.description).trim();
    const nextPrice =
      req.body.price == null
        ? existingItem.price
        : Number.isFinite(Number(req.body.price))
          ? Number(req.body.price)
          : existingItem.price;

    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }
    const nextImage = req.file ? `/uploads/${req.file.filename}` : existingItem.image_url;

    db.prepare(
      `
      UPDATE menu_items
      SET name = ?, description = ?, price = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `
    ).run(nextName, nextDescription, nextPrice, nextImage, itemId);

    const item = db
      .prepare(
        'SELECT id, name, description, price, image_url AS imageUrl, created_at AS createdAt, updated_at AS updatedAt FROM menu_items WHERE id = ?'
      )
      .get(itemId);

    return res.json({ item });
  }
);

app.delete(
  '/api/owner/restaurants/:id/menu-items/:itemId',
  requireAuth,
  requireRole('owner'),
  (req, res) => {
    const restaurantId = Number(req.params.id);
    const itemId = Number(req.params.itemId);

    if (!Number.isFinite(restaurantId) || !Number.isFinite(itemId)) {
      return res.status(400).json({ error: 'invalid ids' });
    }

    const owned = db
      .prepare('SELECT id FROM restaurants WHERE id = ? AND owner_id = ?')
      .get(restaurantId, req.user.id);

    if (!owned) {
      return res.status(404).json({ error: 'owned restaurant not found' });
    }

    const existingItem = db
      .prepare('SELECT id FROM menu_items WHERE id = ? AND restaurant_id = ?')
      .get(itemId, restaurantId);

    if (!existingItem) {
      return res.status(404).json({ error: 'menu item not found' });
    }

    db.prepare('DELETE FROM menu_items WHERE id = ?').run(itemId);
    return res.json({ ok: true });
  }
);

app.get('*', (_req, res) => {
  return res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  return res.status(500).json({ error: err.message || 'internal server error' });
});

module.exports = app;
