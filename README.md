# NearbyBites 🍽️

**Full-stack restaurant discovery app** built with Node.js, Express, SQLite, and a static frontend. Discover restaurants near you, leave reviews, manage listings as an owner, and moderate the platform with a built-in moderator account.

> **Optional cloud mode:** Connect to a [Convex](https://convex.dev) backend for real-time sync, persistent user state, and production-scale deployment.  
> **Optional AI mode:** Add a Gemini API key for AI-powered restaurant tag enrichment.  
> **Optional maps upgrade:** Add a Google Maps API key to use Google Maps tiles and Google Places data instead of OpenStreetMap.

---

## Features

- 🔍 **Location-based discovery** — search restaurants by GPS, address, or map pin
- 🗺️ **Interactive map** — Leaflet/OpenStreetMap by default, Google Maps if a key is provided
- 🏷️ **Smart tagging** — cuisine and dietary tags auto-generated for every restaurant (AI-powered with Gemini, stable fallback without)
- ⭐ **Reviews & ratings** — customers leave reviews, combined with Google ratings where available
- 👤 **Authentication** — JWT-based, with roles: `customer`, `owner`, `moderator`
- 🏪 **Owner dashboard** — create, edit, and manage restaurant listings and menus
- 🛡️ **Moderator dashboard** — hide restaurants, suspend/delete users, delete any review
- 🌙 **Dark mode** — matching system preference, toggleable
- 📱 **Responsive** — works on mobile and desktop

---

## Quick Start

### Prerequisites

- **Node.js v20 or later** (v22 and v25 are both supported)
- **npm** (comes with Node.js)

### 1. Clone and install

```bash
git clone https://github.com/your-username/nearbytes.git
cd nearbytes
npm install
npm install cheerio
```

### 2. Configure environment

```bash
cp .env.example .env
```

Then open `.env` and fill in what you need. **At minimum, no changes are needed to get running locally.** All API keys are optional.

### 3. Seed demo data (optional)

```bash
npm run seed
```

This creates demo restaurants, reviews, and user accounts in `app.db`.

### 4. Start the server

```bash
npm run dev
```

The app will be available at **http://localhost:3000**

---

## Environment Variables

Copy `.env.example` to `.env` and configure as needed.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | Port to run the local server on |
| `JWT_SECRET` | Yes (prod) | `dev-secret-change-me` | Secret used to sign auth tokens. **Change this in production.** |
| `CONVEX_URL` | No | *(blank)* | Your Convex deployment URL. Leave blank to use local SQLite. |
| `GOOGLE_MAPS_API_KEY` | No | *(blank)* | Enables Google Maps tiles, Google Places restaurant data, and Google Geocoding. [Get a key →](https://developers.google.com/maps) |
| `GEMINI_API_KEY` | No | *(blank)* | Enables AI-powered tag enrichment via Gemini. [Get a key →](https://aistudio.google.com/app/apikey) |
| `OSM_NEARBY_RADIUS_METERS` | No | `5000` | Default search radius for nearby restaurants (meters) |
| `CLIENT_ORIGIN` | No | `http://localhost:3000` | Your production domain (used for CORS and links) |

### Setting up Google Maps (optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project and enable these APIs:
   - **Maps JavaScript API** — browser map tiles
   - **Places API (New)** — restaurant discovery
   - **Geocoding API** — address ↔ coordinates
3. Create an API key and add it to `.env` as `GOOGLE_MAPS_API_KEY`

Without this key, the app uses **OpenStreetMap + Overpass API** for restaurant data (no key required, no usage limits).

### Setting up Gemini AI (optional)

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create an API key and add it to `.env` as `GEMINI_API_KEY`

Without this key, restaurants with no tags get **2 stable deterministic tags** assigned based on their name (e.g., "Casual Dining", "Local Favorite"). These are consistent across restarts.

---

## Demo Accounts

After running `npm run seed`, the following accounts are available:

| Role | Email | Password |
|---|---|---|
| Moderator | `nearbytesadmin@email.com` | `nearbytesadmin` |
| Owner | `owner@example.com` | `password123` |
| Customer | `customer@example.com` | `password123` |

> The **moderator account** is automatically created/reset on server startup. You can always log in with these credentials.

### What each role can do

**Customer** — browse restaurants, save favorites, write reviews  
**Owner** — everything a customer can do, plus: create and manage restaurant listings, add photos, manage menus, hide their own restaurant  
**Moderator** — everything an owner can do (for all restaurants), plus: hide/unhide any restaurant, suspend/delete users, delete any review

---

## Project Structure

```
nearbytes/
├── public/                  # Static frontend (HTML, CSS, JS)
│   ├── index.html           # Main page
│   ├── styles.css           # All styles (dark/light themes)
│   ├── app.js               # Frontend app logic
│   ├── services/
│   │   └── restaurant-service.js  # API service layer (Convex or local)
│   └── vendor/
│       └── convex/
│           └── browser.bundle.js  # Convex browser SDK (not loaded without CONVEX_URL)
├── server/                  # Local Express + SQLite backend
│   ├── app.js               # Express routes and API
│   ├── db.js                # SQLite schema and connection
│   ├── auth.js              # JWT helpers and middleware
│   ├── utils.js             # Haversine distance, cursor encoding, etc.
│   ├── index.js             # Server entry point
│   └── seed.js              # Seeds demo data into app.db
├── convex/                  # Convex cloud backend (optional)
│   ├── schema.ts            # Database schema
│   ├── restaurants.ts       # Restaurant queries/mutations
│   ├── auth.ts              # Auth mutations
│   ├── googlePlaces.ts      # Google Places sync
│   ├── googleMaps.ts        # Geocoding actions
│   └── ...
├── scripts/
│   ├── dev.js               # Dev entry point (picks local or Convex mode)
│   ├── dev-static.js        # Static file server for frontend-only dev
│   └── build-static.js      # Builds dist/ for Vercel deployment
├── .env.example             # Environment variable template
├── .env                     # Your local config (gitignored)
├── .nvmrc                   # NVM node version pin (22)
├── package.json
└── vercel.json              # Vercel deployment config
```

---

## Available Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Start the local server (auto-picks Convex or SQLite based on `CONVEX_URL`) |
| `npm run start` | Start the production server (SQLite mode only) |
| `npm run seed` | Seed `app.db` with demo users, restaurants, menus, and reviews |
| `npm run build` | Build the static frontend to `dist/` for Vercel |
| `npm run dev:static` | Serve only the static frontend (no backend) |
| `npm run convex:dev` | Start Convex local dev environment |
| `npm run convex:deploy` | Deploy Convex schema and functions to production |

---

## How it works

### Backend selection

When `npm run dev` starts:
- If `CONVEX_URL` is set in `.env` → uses Convex cloud backend (real-time, deployed)
- If `CONVEX_URL` is blank → starts a local Express server on `PORT` with SQLite (`app.db`)

### Restaurant data

When you search for restaurants near a location:
- With `GOOGLE_MAPS_API_KEY` → fetches from **Google Places API (New)**, stores results in the local DB
- Without → fetches from **OpenStreetMap Overpass API**, stores results in the local DB

All results are cached locally so subsequent loads are fast.

### Tag generation

Every restaurant has cuisine and dietary tags. When a restaurant has no tags:
1. If `GEMINI_API_KEY` is set → Gemini AI generates relevant tags based on the name and address
2. Otherwise → 2 stable, deterministic tags are assigned from a curated pool (consistent across restarts)

---

## Deployment

### Vercel (frontend) + Convex (backend)

1. Push your code to GitHub
2. Import the repo to [Vercel](https://vercel.com)
3. Set the **Output Directory** to `dist`
4. Add environment variables in the Vercel dashboard:
   - `CONVEX_URL` → your Convex deployment URL
   - `CLIENT_ORIGIN` → your Vercel app URL
   - `GOOGLE_MAPS_API_KEY` → (optional)
5. Deploy the Convex backend: `npx convex deploy`
6. Build the frontend: `npm run build`

### Self-hosted (Express + SQLite)

```bash
# On your server
git clone ... && cd nearbytes
npm install
cp .env.example .env
# Fill in JWT_SECRET, PORT, and optional API keys
npm run seed    # optional: seed demo data
npm start       # launch production server
```

---

## Contributing

PRs are welcome. Please:
- Keep commits focused and descriptive
- Test both the local SQLite mode and Convex mode if touching shared logic
- Run `npm run build` to verify the static build still works

---

## License

MIT
