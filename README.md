# Nearbytes

A working prototype web app for discovering nearby restaurants, viewing combined ratings (Google + app reviews), and role-based actions for customers and restaurant owners.

## Features Implemented

- Updated UI for demo (Mar 25, 2026)
- User Login/Registration Features
- Dark/light mode feature
- Add Restaurants (Owner feature)
- Add Menu Items (Owner feature)
- Edit existing restaurant Information (Owner feature)
- Use My Location feature (User feature)
- Location Selection feature (User feature)
- New filter system that filters by dietary restrictions
- User reviews feature
- Edit Restaurant Information (Owner feature)
- View Restaurant Details (Menu, Ratings, Reviews)
- Moderated Reviews (Moderator Feature)
- Location-based suggestions (User feature)

## Local Run

0. Use Node.js 22 LTS (recommended) or 20 LTS.
   - This project uses `better-sqlite3`, which may fail to install on newer Node releases without matching prebuilt binaries.
   - On Windows, if you build native modules from source, install Visual Studio Build Tools with the Windows SDK.
1. Create env file:

```bash
cp .env.example .env
```

2. Install dependencies:

```bash
npm install
npm install cheerio
```

3. Seed demo data:

```bash
npm run seed
```

4. Start app:

```bash
npm run dev
```

5. Open:

- `http://localhost:3000`

## Demo Accounts

- Owner: `owner@example.com` / `Owner@123`
- Customer: `customer@example.com` / `Customer@123  nearbytesadmin`
- Moderator: `nearbytesadmin@email.com` / `nearbytesadmin`

## Smoke Test

Runs core flow checks (auth, nearby listing, reviews, owner operations):

```bash
npm run smoke
```

## Testing Suite

This project follows a comprehensive testing plan covering 33 total test cases. Run the full automated suite (25 tests) with:

```bash
npm test
```

- Unit Tests (Clear Box): to verify core logic like registration, login, and rating calculations. Run

```bash
npx jest server/unit-cb.test.js
```

- Integration Tests (Translucent Box): to verify API and Database interactions. Run

```bash
npx jest server/translucent.test.js
```

- Search & Filter Tests: to test dietary filters and location-based discovery. Run

```bash
npx jest server/search-filter.test.js
```

- Admin Management Tests: to verify owner creation and unauthorized blocking. Run

```bash
npx jest server/admin-mgmt.test.js
```

- Review & Rating Tests: to verify review submission and rating aggregation logic. Run

```bash
npx jest server/reviews.test.js
```

- Error Handling (Opaque Box): to test negative paths like duplicate emails and invalid credentials. Run

```bash
npx jest server/opaque.test.js
```

- (Note: The remaining 8 System Tests are executed manually in the browser per the Phase 3 Testing Plan).

## Google Places Setup (Optional)

Add this in `.env`:

```env
GOOGLE_PLACES_API_KEY=your_key_here
GOOGLE_NEARBY_RADIUS_METERS=3000
```

Without this key, the app still works with local seeded + owner-created restaurants.

## Stack

- Backend: Node.js, Express, SQLite (`better-sqlite3`)
- Frontend: Vanilla HTML/CSS/JS SPA
- Auth: JWT token auth
- Uploads: Multer (local disk uploads)

## Project Structure

- `server/app.js`: Express app and API routes
- `server/index.js`: app bootstrap and listen
- `server/db.js`: SQLite schema and DB init
- `server/auth.js`: JWT middleware and auth helpers
- `server/googlePlaces.js`: Nearby sync from Google Places API
- `server/seed.js`: demo seed script
- `server/smoke-test.js`: endpoint smoke checks
- `public/index.html`: UI shell
- `public/styles.css`: responsive styles
- `public/app.js`: frontend app logic

## Notes

- Images upload to local `/uploads`.
- Nearby pagination uses cursor-based offset encoding.
- Combined rating formula is weighted by rating counts.

## Collaborators

- Talha Hassan
- Karan Bhaskar
- Rayan Khan
- Mohammad Jafari
- Dev Shah
