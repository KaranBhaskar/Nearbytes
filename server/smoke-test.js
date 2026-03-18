require('dotenv').config();
const assert = require('assert');
const request = require('supertest');
const app = require('./app');
const { seed } = require('./seed');

async function run() {
  seed();

  const nearby = await request(app)
    .get('/api/restaurants/nearby')
    .query({ lat: 37.7937, lng: -122.395, limit: 2 })
    .expect(200);

  assert(Array.isArray(nearby.body.items), 'nearby.items should be an array');
  assert.strictEqual(nearby.body.items.length, 2, 'nearby.items should return the requested page size');
  assert(nearby.body.nextCursor, 'nearby should provide a cursor when more restaurants are available');

  const secondPage = await request(app)
    .get('/api/restaurants/nearby')
    .query({ lat: 37.7937, lng: -122.395, limit: 2, cursor: nearby.body.nextCursor })
    .expect(200);

  const seenIds = [...nearby.body.items, ...secondPage.body.items].map((item) => item.id);
  assert.strictEqual(new Set(seenIds).size, seenIds.length, 'nearby pagination should not duplicate restaurants');
  const restaurantId = nearby.body.items[0].id;

  await request(app)
    .post(`/api/restaurants/${restaurantId}/reviews`)
    .send({ rating: 5, comment: 'Guest review should fail' })
    .expect(401);

  const signup = await request(app).post('/api/auth/signup').send({
    name: 'Smoke Customer',
    email: `smoke+${Date.now()}@example.com`,
    password: 'SmokePass@123',
    role: 'customer',
  });

  assert(signup.body.token, 'signup should return token');

  await request(app)
    .post(`/api/restaurants/${restaurantId}/reviews`)
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ rating: 4, comment: 'Solid place in smoke test' })
    .expect(201);

  await request(app)
    .post(`/api/restaurants/${restaurantId}/reviews`)
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ rating: 5, comment: 'Updated through the same review form flow' })
    .expect(201);

  const ownerLogin = await request(app).post('/api/auth/login').send({
    email: 'owner@example.com',
    password: 'Owner@123',
  });

  assert(ownerLogin.body.token, 'owner login should return token');

  const createdRestaurant = await request(app)
    .post('/api/owner/restaurants')
    .set('Authorization', `Bearer ${ownerLogin.body.token}`)
    .send({
      name: 'Smoke Owner Spot',
      address: '123 Test Lane, San Francisco, CA',
      lat: 37.79,
      lng: -122.40,
      cuisineTags: 'Test,Prototype',
    })
    .expect(201);

  const ownerRestaurantId = createdRestaurant.body.restaurant.id;
  assert(ownerRestaurantId, 'owner restaurant should be created');

  await request(app)
    .post(`/api/owner/restaurants/${ownerRestaurantId}/images`)
    .set('Authorization', `Bearer ${ownerLogin.body.token}`)
    .attach('images', Buffer.from('smoke-image'), {
      filename: 'smoke-cover.png',
      contentType: 'image/png',
    })
    .expect(201);

  await request(app)
    .post(`/api/owner/restaurants/${ownerRestaurantId}/menu-items`)
    .set('Authorization', `Bearer ${ownerLogin.body.token}`)
    .field('name', 'Smoke Burger')
    .field('price', '12.50')
    .field('description', 'Menu item from smoke test')
    .expect(201);

  const customerDetails = await request(app)
    .get(`/api/restaurants/${restaurantId}`)
    .set('Authorization', `Bearer ${signup.body.token}`)
    .expect(200);

  assert(customerDetails.body.restaurant, 'restaurant details should include restaurant object');
  assert.strictEqual(customerDetails.body.myReview.rating, 5, 'customer detail should reflect updated review');

  const ownerRestaurantDetails = await request(app)
    .get(`/api/restaurants/${ownerRestaurantId}`)
    .expect(200);

  assert.strictEqual(ownerRestaurantDetails.body.images.length, 1, 'owner restaurant should expose uploaded images');
  assert.strictEqual(ownerRestaurantDetails.body.menuItems.length, 1, 'owner restaurant should expose menu items');

  const ownerList = await request(app)
    .get('/api/owner/restaurants')
    .set('Authorization', `Bearer ${ownerLogin.body.token}`)
    .expect(200);

  assert(Array.isArray(ownerList.body.restaurants), 'owner list should be array');
  assert(ownerList.body.restaurants.length >= 1, 'owner list should include at least one restaurant');
  assert(
    ownerList.body.restaurants.some((restaurant) => restaurant.id === ownerRestaurantId),
    'owner list should include the newly created restaurant'
  );

  // eslint-disable-next-line no-console
  console.log('Smoke test passed. Key flows are operational.');
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Smoke test failed:', err);
  process.exitCode = 1;
});
