const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nearbytes-test-'));

process.env.DB_PATH = path.join(testRoot, 'app.test.db');
process.env.UPLOADS_DIR = path.join(testRoot, 'uploads');
process.env.JWT_SECRET = 'test-secret';

jest.mock('./googlePlaces', () => ({
  syncGoogleNearby: jest.fn().mockResolvedValue({ synced: 0, reason: 'disabled_in_tests' }),
}));

const app = require('./app');
const { closeDb } = require('./db');
const { seed } = require('./seed');

const baseLocation = {
  lat: 37.7937,
  lng: -122.395,
};

async function signupCustomer(overrides = {}) {
  const payload = {
    name: 'Flow Customer',
    email: `customer+${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    password: 'Customer@123',
    role: 'customer',
    ...overrides,
  };

  const response = await request(app).post('/api/auth/signup').send(payload).expect(201);
  return response.body;
}

async function loginOwner() {
  const response = await request(app).post('/api/auth/login').send({
    email: 'owner@example.com',
    password: 'Owner@123',
  });

  expect(response.status).toBe(200);
  return response.body;
}

async function loginModerator(overrides = {}) {
  const response = await request(app).post('/api/auth/login').send({
    email: 'nearbytesadmin@email.com',
    password: 'nearbytesadmin',
    loginMode: 'moderator',
    ...overrides,
  });

  expect(response.status).toBe(200);
  return response.body;
}

function getNearby(query = {}) {
  return request(app)
    .get('/api/restaurants/nearby')
    .query({
      ...baseLocation,
      limit: 20,
      ...query,
    });
}

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

beforeEach(() => {
  seed();
});

afterAll(() => {
  closeDb();
  fs.rmSync(testRoot, { recursive: true, force: true });
  delete process.env.DB_PATH;
  delete process.env.JWT_SECRET;
  delete process.env.UPLOADS_DIR;
  console.error.mockRestore();
  console.log.mockRestore();
  console.warn.mockRestore();
});

describe('Nearby Bites API flows', () => {
  test('guest can browse nearby restaurants with stable pagination and details', async () => {
    const firstPage = await getNearby({ limit: 2 }).expect(200);

    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.total).toBe(3);
    expect(firstPage.body.hasMore).toBe(true);
    expect(firstPage.body.nextCursor).toBeTruthy();
    expect(firstPage.body.items[0].distanceKm).toBeLessThanOrEqual(firstPage.body.items[1].distanceKm);

    const secondPage = await getNearby({
      limit: 2,
      cursor: firstPage.body.nextCursor,
    }).expect(200);

    const seenIds = [...firstPage.body.items, ...secondPage.body.items].map((item) => item.id);
    expect(new Set(seenIds).size).toBe(seenIds.length);
    expect(secondPage.body.hasMore).toBe(false);

    const restaurantId = firstPage.body.items[0].id;
    const details = await request(app).get(`/api/restaurants/${restaurantId}`).expect(200);
    const reviews = await request(app).get(`/api/restaurants/${restaurantId}/reviews`).expect(200);

    expect(details.body.restaurant.id).toBe(restaurantId);
    expect(details.body.images.length).toBeGreaterThan(0);
    expect(details.body.menuItems.length).toBeGreaterThan(0);
    expect(details.body.myReview).toBeNull();
    expect(reviews.body.reviews.length).toBeGreaterThan(0);
  });

  test('customer can sign up and manage their review through the POST-update flow', async () => {
    const nearby = await getNearby().expect(200);
    const unratedRestaurant = nearby.body.items.find((item) => item.appRatingCount === 0);

    expect(unratedRestaurant).toBeDefined();

    const auth = await signupCustomer();
    const authHeader = { Authorization: `Bearer ${auth.token}` };

    await request(app)
      .post(`/api/restaurants/${unratedRestaurant.id}/reviews`)
      .send({ rating: 4, comment: 'First pass' })
      .expect(401);

    await request(app)
      .post(`/api/restaurants/${unratedRestaurant.id}/reviews`)
      .set(authHeader)
      .send({ rating: 4, comment: 'First pass' })
      .expect(201);

    let details = await request(app)
      .get(`/api/restaurants/${unratedRestaurant.id}`)
      .set(authHeader)
      .expect(200);

    expect(details.body.myReview.rating).toBe(4);
    expect(details.body.restaurant.appRating).toBe(4);
    expect(details.body.restaurant.appRatingCount).toBe(1);
    expect(details.body.restaurant.combinedRatingCount).toBe(unratedRestaurant.googleRatingCount + 1);

    await request(app)
      .post(`/api/restaurants/${unratedRestaurant.id}/reviews`)
      .set(authHeader)
      .send({ rating: 2, comment: 'Updated through the same form flow' })
      .expect(201);

    const reviews = await request(app)
      .get(`/api/restaurants/${unratedRestaurant.id}/reviews`)
      .expect(200);

    expect(reviews.body.reviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userName: 'Flow Customer',
          rating: 2,
          comment: 'Updated through the same form flow',
        }),
      ])
    );

    details = await request(app)
      .get(`/api/restaurants/${unratedRestaurant.id}`)
      .set(authHeader)
      .expect(200);

    expect(details.body.myReview.rating).toBe(2);
    expect(details.body.restaurant.appRating).toBe(2);
    expect(details.body.restaurant.appRatingCount).toBe(1);

    await request(app)
      .delete(`/api/restaurants/${unratedRestaurant.id}/reviews/${details.body.myReview.id}`)
      .set(authHeader)
      .expect(200);

    details = await request(app)
      .get(`/api/restaurants/${unratedRestaurant.id}`)
      .set(authHeader)
      .expect(200);

    expect(details.body.myReview).toBeNull();
    expect(details.body.restaurant.appRating).toBeNull();
    expect(details.body.restaurant.appRatingCount).toBe(0);
  });

  test('stale auth token is rejected before review insert hits foreign key constraints', async () => {
    const nearby = await getNearby().expect(200);
    const unratedRestaurant = nearby.body.items.find((item) => item.appRatingCount === 0);

    expect(unratedRestaurant).toBeDefined();

    const auth = await signupCustomer();
    const { getDb } = require('./db');
    getDb().prepare('DELETE FROM users WHERE id = ?').run(auth.user.id);

    const response = await request(app)
      .post(`/api/restaurants/${unratedRestaurant.id}/reviews`)
      .set('Authorization', `Bearer ${auth.token}`)
      .send({ rating: 5, comment: 'Should fail cleanly' })
      .expect(401);

    expect(response.body.error).toBe('Invalid or expired token');
  });

  test('moderator account requires moderator login mode and can remove any review', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({
        email: 'nearbytesadmin@email.com',
        password: 'nearbytesadmin',
      })
      .expect(403);

    const moderator = await loginModerator();
    expect(moderator.user.role).toBe('moderator');

    const seededReview = await request(app).get('/api/restaurants/1/reviews').expect(200);
    const existingReviewId = seededReview.body.reviews[0].id;

    await request(app)
      .delete(`/api/restaurants/1/reviews/${existingReviewId}`)
      .set('Authorization', `Bearer ${moderator.token}`)
      .expect(200);

    const afterDelete = await request(app).get('/api/restaurants/1/reviews').expect(200);
    expect(afterDelete.body.reviews.some((review) => review.id === existingReviewId)).toBe(false);
  });

  test('owner can create a restaurant, upload images, add a menu item, and see it in discovery', async () => {
    const owner = await loginOwner();
    const authHeader = { Authorization: `Bearer ${owner.token}` };

    const createdRestaurant = await request(app)
      .post('/api/owner/restaurants')
      .set(authHeader)
      .send({
        name: 'Owner Flow Spot',
        address: '1 Test Plaza, San Francisco, CA',
        lat: 37.7939,
        lng: -122.3949,
        cuisineTags: 'Brunch,Fusion',
        description: 'Built in tests',
      })
      .expect(201);

    const restaurantId = createdRestaurant.body.restaurant.id;
    expect(createdRestaurant.body.restaurant.cuisineTags).toEqual(['Brunch', 'Fusion']);

    const upload = await request(app)
      .post(`/api/owner/restaurants/${restaurantId}/images`)
      .set(authHeader)
      .attach('images', Buffer.from('image-one'), {
        filename: 'cover.png',
        contentType: 'image/png',
      })
      .attach('images', Buffer.from('image-two'), {
        filename: 'room.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    expect(upload.body.images).toHaveLength(2);
    expect(upload.body.images[0].isCover).toBe(true);
    expect(upload.body.images[1].isCover).toBe(false);

    await request(app)
      .post(`/api/owner/restaurants/${restaurantId}/menu-items`)
      .set(authHeader)
      .field('name', 'Smash Burger')
      .field('description', 'Double patty test item')
      .field('price', '14.25')
      .attach('image', Buffer.from('menu-image'), {
        filename: 'burger.png',
        contentType: 'image/png',
      })
      .expect(201);

    const ownerList = await request(app)
      .get('/api/owner/restaurants')
      .set(authHeader)
      .expect(200);

    expect(ownerList.body.restaurants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: restaurantId,
          imageCount: 2,
          menuItemCount: 1,
        }),
      ])
    );

    const details = await request(app).get(`/api/restaurants/${restaurantId}`).expect(200);
    const nearby = await getNearby().expect(200);

    expect(details.body.images).toHaveLength(2);
    expect(details.body.menuItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Smash Burger',
          price: 14.25,
        }),
      ])
    );
    expect(nearby.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: restaurantId,
          name: 'Owner Flow Spot',
        }),
      ])
    );
  });

  test('role protections block the wrong user from review and owner actions', async () => {
    const nearby = await getNearby().expect(200);
    const restaurantId = nearby.body.items[0].id;
    const owner = await loginOwner();
    const customer = await signupCustomer({
      name: 'Second Customer',
    });

    await request(app)
      .post(`/api/restaurants/${restaurantId}/reviews`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ rating: 5, comment: 'Owners should not review' })
      .expect(403);

    await request(app)
      .post('/api/owner/restaurants')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({
        name: 'Should Fail',
        address: '123 No Access Ave',
        lat: 37.79,
        lng: -122.4,
      })
      .expect(403);

    const seededReview = await request(app).get('/api/restaurants/1/reviews').expect(200);
    const existingReviewId = seededReview.body.reviews[0].id;

    await request(app)
      .delete(`/api/restaurants/1/reviews/${existingReviewId}`)
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(403);
  });
});
