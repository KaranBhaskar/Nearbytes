# Frontend

This repo's frontend is a static app deployed to Vercel.

Source of truth:

- `public/` for HTML, CSS, and browser JavaScript
- `scripts/build-static.js` for the production build
- `scripts/dev-static.js` for local static serving
- `vercel.json` for Vercel output settings

Deployment output:

- `dist/`

Required frontend environment variables on Vercel:

- `CONVEX_URL`
- `GOOGLE_MAPS_BROWSER_KEY`
- `CLIENT_ORIGIN`

Recommended deployment flow:

1. Build with `npm run build`
2. Upload `dist/` through Vercel, or connect the repo and set Output Directory to `dist`
