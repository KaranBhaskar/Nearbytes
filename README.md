# Nearbytes

A restaurant discovery app with a static frontend, a Convex backend, Google Maps for location search, Google Places for nearby restaurant data, and Gemini for light fallback enrichment when Google metadata is incomplete.

## Architecture

- Frontend: static app from `public/`
- Backend: Convex functions in `convex/`
- Hosting: Vercel for the frontend, Convex for the backend
- Map picker: Google Maps JavaScript API
- Nearby data: Google Places synced through Convex
- Auth and roles: Convex-backed email/password accounts for `customer`, `owner`, and `moderator`

There is no local restaurant fallback mode anymore. If `CONVEX_URL` is missing, the app is intentionally unconfigured instead of silently switching to demo data.

## Local Run

1. Use Node.js 22 LTS or 20 LTS.
2. Create your env file:

```bash
cp .env.example .env.local
```

3. Install dependencies:

```bash
npm install
```

4. Connect Convex:

```bash
npx convex dev
```

This creates or updates your local Convex values.

5. Start the frontend:

```bash
npm run dev
```

6. Open:

- `http://localhost:3000`

`localhost` is treated as a secure origin by modern browsers, so browser geolocation works locally without a custom HTTPS dev certificate.

## Required Environment Variables

Add these to `.env.local` for local work:

```env
CONVEX_DEPLOYMENT=
CONVEX_URL=
CLIENT_ORIGIN=http://localhost:3000
GOOGLE_MAPS_API_KEY=
GOOGLE_MAPS_BROWSER_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite
GOOGLE_NEARBY_RADIUS_METERS=5000
```

Notes:

- `GOOGLE_MAPS_API_KEY` is used on the Convex backend for Google geocoding and Places sync.
- `GOOGLE_MAPS_BROWSER_KEY` is used by the visible Google map widget in the browser.
- `GEMINI_API_KEY` is only used when Google metadata is missing menu or tag hints.
- `GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash-lite` for faster structured tag enrichment.
- `GOOGLE_PLACES_API_KEY` is still accepted as a legacy alias for the backend key, but `GOOGLE_MAPS_API_KEY` is the preferred name.
- The frontend build only reads `GOOGLE_MAPS_BROWSER_KEY`. It will not fall back to backend Google keys, so `GOOGLE_MAPS_API_KEY` and `GEMINI_API_KEY` stay server-only.

For Convex actions to see the backend keys, set them on the Convex deployment too:

```bash
npx convex env set GOOGLE_MAPS_API_KEY ...
npx convex env set GEMINI_API_KEY ...
```

Keep `GOOGLE_MAPS_BROWSER_KEY` in `.env.local` for local dev and in Vercel environment variables for production.
Do not put `GOOGLE_MAPS_API_KEY` or `GEMINI_API_KEY` into Vercel frontend env unless you explicitly intend to expose them.

## Deploying

### Convex backend

Development sync:

```bash
npx convex dev
```

Production deploy from your machine:

```bash
npx convex deploy
```

This pushes the code in `convex/` to your production Convex deployment.

### Vercel frontend

Build the static site:

```bash
npm run build
```

That writes a deployment-ready build to `dist/`.

Recommended Vercel settings:

- Framework Preset: `Other`
- Root Directory: repo root
- Build Command: `npm run build`
- Output Directory: `dist`

Vercel environment variables:

```env
CONVEX_URL=https://your-production-deployment.convex.cloud
CLIENT_ORIGIN=https://your-app.vercel.app
GOOGLE_MAPS_BROWSER_KEY=your_browser_restricted_google_maps_key
```

You can also copy the frontend-only variables from:

- `frontend/vercel.env.example`

Recommended browser-key restrictions:

- `http://localhost:3000/*`
- your Vercel domain
- `Maps JavaScript API`

## Features In Scope Right Now

- Current location detection with reverse geocoded city labels
- Manual city/address search with Google geocoding
- Nearby restaurant loading from Google Places through Convex
- Pagination with 10 results at a time
- Google photos when available
- Customer favorites and reviews
- Owner-created restaurants, menus, and image URLs
- Moderator hide/delete restaurant controls
- Moderator suspend/delete user controls

## Project Structure

- `convex/schema.ts`: Convex schema
- `convex/auth.ts`: auth, user moderation, session flows
- `convex/restaurants.ts`: restaurant queries and mutations
- `convex/googleMaps.ts`: geocoding and reverse geocoding
- `convex/googlePlaces.ts`: Google Places sync plus Gemini enrichment
- `public/index.html`: UI shell
- `public/app.js`: frontend orchestration
- `public/services/restaurant-service.js`: frontend data boundary
- `scripts/dev-static.js`: local static dev server with runtime config
- `scripts/build-static.js`: static production build step

## Notes

- `convex/_generated/` is intentionally ignored and should stay local.
- `.env.local` is intentionally ignored and should never be committed.
- `dist/` is generated output and should not be committed.
- The frontend/backend coupling is intentionally narrow: the browser reads `CONVEX_URL` and talks through `public/services/restaurant-service.js`.
