# Nearby Bites Prototype

A working prototype web app for discovering nearby restaurants, viewing combined ratings (Google + app reviews), and role-based actions for customers and restaurant owners.

## Features Implemented
- Simple UI for demo
- User Login/Registration Features
- Dark/light mode feature
- Add Restaurants (Admin feature)
- Add Menu Items (Admin feature)
- Use My Location feature
  
## Local Run
1. Create env file:
```bash
cp .env.example .env 
```
2. Install dependencies:
```bash
npm install
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
- Customer: `customer@example.com` / `Customer@123`

## Smoke Test
Runs core flow checks (auth, nearby listing, reviews, owner operations):
```bash
npm run smoke
```

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
