# Nearbytes

A prototype web app for discovering nearby restaurants with a static frontend, a Convex-backed data path, and a local demo fallback for UI work.

## Current Direction

- Frontend runs as a static app from `public/`
- Restaurant discovery is routed through `public/services/restaurant-service.js`
- Convex is the active backend integration path
- If Convex is unavailable, the app can still run in local demo mode with stable fallback restaurant data
- UI work can continue without requiring every collaborator to have Convex configured

## Local Run

0. Use Node.js 22 LTS (recommended) or 20 LTS.
1. Create env file:

```bash
cp .env.example .env.local
```

2. Install dependencies:

```bash
npm install
npm install cheerio
```

3. Optional: connect Convex:

```bash
npx convex dev
```

This will create/update `.env.local` with your Convex values.

3.5. Optional: preload the demo fallback restaurants into Convex once:

```bash
npm run convex:seed-demo
```

If you skip this, the app can still fall back to local demo data without writing to Convex.

4. Start app:

```bash
npm run dev
```

5. Open:

- `http://localhost:3000`

If `CONVEX_URL` is missing or Convex cannot be reached, the app will fall back to local demo restaurants so frontend work can continue safely.

## Google Places Setup (Optional)

Add this in `.env.local`:

```env
GOOGLE_PLACES_API_KEY=your_key_here
GOOGLE_NEARBY_RADIUS_METERS=3000
```

Without this key, the app still works with local demo restaurants.

## Stack

- Backend data path: Convex
- Frontend: Vanilla HTML/CSS/JS SPA
- Static dev server: lightweight Node HTTP server in `scripts/`
- Local fallback mode: browser-side demo restaurant data

## Project Structure

- `convex/schema.ts`: Convex schema
- `convex/restaurants.ts`: Convex restaurant queries and mutations
- `convex/fallbackRestaurants.ts`: fallback restaurant records inserted into Convex
- `public/index.html`: UI shell
- `public/styles.css`: responsive styles
- `public/app.js`: frontend app orchestration
- `public/services/restaurant-service.js`: low-coupling frontend data layer
- `public/services/demo-restaurants.js`: local demo fallback data
- `scripts/dev-static.js`: static app server and runtime config route
- `scripts/dev.js`: local dev entrypoint

## Notes

- `convex/_generated/` is intentionally ignored and should stay local to whoever is running Convex.
- `.env.local` is intentionally ignored and should not be committed.
- The old Express/SQLite backend has been removed from the active architecture.
- The app reads from Convex when available, but falls back to local demo data if Convex is empty or unavailable.
