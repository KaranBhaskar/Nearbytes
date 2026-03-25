require('dotenv').config();
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');

function seed() {
  const db = getDb();
  const ownerPassword = bcrypt.hashSync('Owner@123', 10);
  const customerPassword = bcrypt.hashSync('Customer@123', 10);

  const transaction = db.transaction(() => {
    db.exec(`
      DELETE FROM reviews;
      DELETE FROM menu_items;
      DELETE FROM restaurant_images;
      DELETE FROM restaurants;
      DELETE FROM users;
      DELETE FROM sqlite_sequence;
    `);

    const insertUser = db.prepare(
      'INSERT INTO users(name, email, password_hash, role) VALUES (?, ?, ?, ?)'
    );

    const ownerInfo = insertUser.run('Demo Owner', 'owner@example.com', ownerPassword, 'owner');
    const customerInfo = insertUser.run(
      'Demo Customer',
      'customer@example.com',
      customerPassword,
      'customer'
    );
    const ownerId = ownerInfo.lastInsertRowid;
    const customerId = customerInfo.lastInsertRowid;

    const insertRestaurant = db.prepare(`
      INSERT INTO restaurants(
        owner_id, name, address, lat, lng, description, phone, website, cuisine_tags, dietary_tags,
        google_place_id, google_rating, google_rating_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const r1 = insertRestaurant.run(
      ownerId,
      'Golden Spoon Bistro',
      '123 Market St, San Francisco, CA',
      37.7937,
      -122.395,
      'Contemporary California cuisine with seasonal menus.',
      '(415) 555-0101',
      'https://example.com/golden-spoon',
      JSON.stringify(['Californian', 'Brunch']),
      JSON.stringify(['gluten-free']),
      'seed_place_1',
      4.3,
      128
    ).lastInsertRowid;

    const r2 = insertRestaurant.run(
      null,
      'Harbor Noodle House',
      '89 Embarcadero, San Francisco, CA',
      37.7956,
      -122.3933,
      'Hand-pulled noodles and coastal-inspired broths.',
      '(415) 555-0133',
      null,
      JSON.stringify(['Asian', 'Noodles']),
      JSON.stringify(['halal']),
      'seed_place_2',
      4.1,
      342
    ).lastInsertRowid;

    const r3 = insertRestaurant.run(
      null,
      'Sunset Tacos',
      '412 Mission St, San Francisco, CA',
      37.7898,
      -122.3969,
      'Street-style tacos and fresh agua frescas.',
      '(415) 555-0199',
      null,
      JSON.stringify(['Mexican', 'Casual']),
      JSON.stringify(['vegan', 'gluten-free']),
      'seed_place_3',
      4.5,
      229
    ).lastInsertRowid;

    const insertImage = db.prepare(
      'INSERT INTO restaurant_images(restaurant_id, url, is_cover) VALUES (?, ?, ?)'
    );

    insertImage.run(r1, 'https://images.unsplash.com/photo-1552566626-52f8b828add9?w=1200', 1);
    insertImage.run(r1, 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1200', 0);
    insertImage.run(r2, 'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=1200', 1);
    insertImage.run(r3, 'https://images.unsplash.com/photo-1565299585323-38174c4a6d41?w=1200', 1);

    const insertMenu = db.prepare(
      'INSERT INTO menu_items(restaurant_id, name, description, price, image_url) VALUES (?, ?, ?, ?, ?)'
    );

    insertMenu.run(r1, 'Truffle Omelette', 'Farm eggs, gruyere, herbs, truffle oil.', 18.0, null);
    insertMenu.run(r1, 'Roasted Salmon', 'King salmon, fennel, citrus beurre blanc.', 32.0, null);
    insertMenu.run(r2, 'Spicy Miso Ramen', 'Rich miso broth, pork belly, ajitama egg.', 16.5, null);
    insertMenu.run(r2, 'Garlic Chili Noodles', 'Wok tossed noodles with chili crisp.', 14.0, null);
    insertMenu.run(r3, 'Al Pastor Taco', 'Pineapple, achiote pork, onion, cilantro.', 5.5, null);
    insertMenu.run(r3, 'Mushroom Taco', 'Roasted mushrooms, salsa verde, queso.', 5.0, null);

    const insertReview = db.prepare(
      'INSERT INTO reviews(restaurant_id, user_id, rating, comment) VALUES (?, ?, ?, ?)'
    );

    insertReview.run(r1, customerId, 5, 'Excellent brunch and very friendly staff.');
    insertReview.run(r2, customerId, 4, 'Great noodles, portion size is good.');
  });

  transaction();

  // eslint-disable-next-line no-console
  console.log('Seed complete. Demo users: owner@example.com / Owner@123, customer@example.com / Customer@123');
}

if (require.main === module) {
  seed();
}

module.exports = { seed };
