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

## Deploying

### Convex backend

Local development deployment:

```bash
npx convex dev
```

Production deployment from your machine:

```bash
npx convex deploy
```

This pushes the code in `convex/` to your project's production deployment. Convex keeps the backend separate from Vercel. Your frontend only needs the production `CONVEX_URL`.

See the official docs:

- [Convex project configuration](https://docs.convex.dev/production/project-configuration)
- [Convex production deploys](https://docs.convex.dev/production)

### Vercel frontend

This repo now has a static build step:

```bash
npm run build
```

That creates `dist/` and writes a deployment-ready `runtime-config.js` using your environment variables.

Recommended Vercel settings:

- Framework Preset: `Other`
- Root Directory: repo root
- Build Command: `npm run build`
- Output Directory: `dist`

Set these Vercel environment variables:

```env
CONVEX_URL=https://your-production-deployment.convex.cloud
CLIENT_ORIGIN=https://your-app.vercel.app
```

`CLIENT_ORIGIN` is included for future HTTP/CORS checks. The current app's browser-to-Convex query/mutation path is protected by backend auth and role checks, not by CORS.

Useful Vercel docs:

- [Deployments](https://vercel.com/docs/platform/deployments)
- [Project configuration](https://vercel.com/docs/projects/project-configuration)
- [Environment variables](https://vercel.com/docs/environment-variables)

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
- Frontend/back-end coupling is intentionally narrow: the browser only depends on `CONVEX_URL` and the API adapter in `public/services/restaurant-service.js`.
