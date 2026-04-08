# Restaurant Discovery + Reviews Prototype (MVP) Requirements

> Legacy product/spec document from the pre-Convex backend phase. It is kept for historical context and does not describe the current runtime architecture.

## 1) Objective
Build a working web app prototype where:
- Users can enter/share a location and browse nearby restaurants.
- Restaurant results load continuously as the user scrolls (infinite scroll pagination).
- Guests can browse without signing up.
- Users must sign up/log in to submit reviews.
- Restaurant owners can sign up, create restaurant listings, and upload photos/menu items.
- Restaurant scores show a combined rating using Google Maps rating + in-app user reviews.

## 2) MVP Scope
### In scope
- Location capture (browser geolocation + manual location input fallback).
- Nearby restaurant feed with infinite scroll.
- Public restaurant browsing (no login required).
- Authentication for review actions.
- Owner onboarding and restaurant management.
- Image upload for restaurant and menu items.
- Combined rating display per restaurant.

### Out of scope (for prototype)
- Payments/reservations/delivery.
- Advanced moderation workflows.
- Native mobile apps.
- Multi-language support.
- Complex recommendation engine.

## 3) User Roles
### Guest (not signed in)
- Can view nearby restaurants and restaurant details.
- Cannot create/edit/delete reviews.
- Cannot create/edit restaurant listings.

### Customer (signed in)
- All guest capabilities.
- Can create, edit, and delete their own reviews.

### Restaurant Owner (signed in)
- All guest capabilities.
- Can create and manage owned restaurant listings.
- Can upload/edit restaurant photos.
- Can create/edit menu items with optional images.

## 4) Core Functional Requirements
### 4.1 Location and Discovery
- System asks user for location on app entry.
- If location permission denied, user can type city/address/zip and search.
- Results are sorted by distance by default.
- Each result includes:
  - Restaurant name
  - Address
  - Distance
  - Cover image (if available)
  - Google rating + count (if available)
  - App rating + count
  - Combined rating

### 4.2 Infinite Scroll Pagination
- Initial page loads a fixed batch (e.g., 20 restaurants).
- When user reaches near end of list, next batch auto-loads.
- Use cursor-based pagination for stable ordering.
- Prevent duplicate entries between pages.
- Stop loading when no more results.
- Show loading indicator and graceful error/retry UI for page fetch failures.

### 4.3 Authentication and Authorization
- Sign up/log in required only for:
  - Posting reviews
  - Owner restaurant management actions
- Role selection during signup: `customer` or `owner`.
- Unauthorized attempts to review/manage listings must redirect to auth flow.

### 4.4 Reviews
- Customers can submit 1–5 star rating + optional text.
- One review per user per restaurant (update allowed).
- Reviews show author display name, rating, text, created date.
- Restaurant detail page shows:
  - App average rating + total app reviews
  - Google rating + total Google reviews (if present)
  - Combined rating + combined count

### 4.5 Owner Restaurant Management
- Owners can create restaurant listing with:
  - Name
  - Address/location
  - Description
  - Contact info
  - Cuisine tags
- Owners can upload multiple restaurant photos.
- Owners can add/edit/delete menu items:
  - Item name
  - Description
  - Price
  - Optional image
- Owners can edit/delete only their own restaurant records.

## 5) Rating Aggregation Rules
To combine Google and in-app ratings:
- Let:
  - `google_avg`, `google_count`
  - `app_avg`, `app_count`
- Combined average:
  - If both counts > 0:
    - `combined_avg = ((google_avg * google_count) + (app_avg * app_count)) / (google_count + app_count)`
  - If only one source exists, use that source average.
  - If none exists, show "No ratings yet".
- Combined count:
  - `combined_count = google_count + app_count`

## 6) External Integration Requirements
### Google Maps / Places
- Use Google Places APIs for nearby discovery and Google rating metadata.
- Store Place ID to map local restaurant records with Google places.
- Respect Google attribution/branding requirements where needed.
- Cache external responses for performance/rate-limit protection.

## 7) Data Model (MVP)
### User
- `id`, `name`, `email`, `password_hash`, `role` (`customer` | `owner`), timestamps

### Restaurant
- `id`, `owner_id` (nullable for Google-only imported records), `name`, `address`, `lat`, `lng`, `description`, `phone`, `website`, `google_place_id` (nullable), timestamps

### RestaurantImage
- `id`, `restaurant_id`, `url`, `is_cover`, timestamps

### MenuItem
- `id`, `restaurant_id`, `name`, `description`, `price`, `image_url` (nullable), timestamps

### Review
- `id`, `restaurant_id`, `user_id`, `rating`, `comment`, timestamps
- Unique constraint: (`restaurant_id`, `user_id`)

### ExternalRatingSnapshot (optional but recommended)
- `id`, `restaurant_id`, `source` (`google`), `avg_rating`, `rating_count`, `fetched_at`

## 8) API Requirements (MVP)
### Public
- `GET /api/restaurants/nearby?lat=..&lng=..&cursor=..&limit=..`
- `GET /api/restaurants/:id`
- `GET /api/restaurants/:id/reviews`

### Auth
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/logout`

### Customer-only
- `POST /api/restaurants/:id/reviews`
- `PUT /api/restaurants/:id/reviews/:reviewId`
- `DELETE /api/restaurants/:id/reviews/:reviewId`

### Owner-only
- `POST /api/owner/restaurants`
- `PUT /api/owner/restaurants/:id`
- `DELETE /api/owner/restaurants/:id`
- `POST /api/owner/restaurants/:id/images`
- `POST /api/owner/restaurants/:id/menu-items`
- `PUT /api/owner/restaurants/:id/menu-items/:itemId`
- `DELETE /api/owner/restaurants/:id/menu-items/:itemId`

## 9) UI/UX Requirements
- Landing flow asks for location immediately.
- Restaurant list must be mobile-first and responsive.
- Infinite scroll should feel smooth and avoid jumpy layout shifts.
- Restaurant detail page includes:
  - Gallery
  - Menu section
  - Google/App/Combined rating panel
  - Reviews list + review form (if logged in as customer)
- Auth prompts should be contextual (only when gated action is attempted).

## 10) Non-Functional Requirements
- Secure password hashing and session/JWT handling.
- Basic rate limiting for auth and review endpoints.
- Input validation on all write endpoints.
- Image upload limits and MIME-type validation.
- Basic logging for API errors and integration failures.

## 11) Acceptance Criteria
- Guest can open app, provide location, and browse nearby restaurants without login.
- Scrolling near bottom automatically loads more restaurants until exhausted.
- Unauthenticated user attempting review is prompted to sign up/log in.
- Signed-in customer can create/update/delete their review.
- Signed-in owner can create restaurant listing and add images/menu items.
- Restaurant detail page shows Google rating, app rating, and computed combined rating.
- Pagination, auth gating, and role permissions work correctly.

## 12) Assumptions To Confirm
- Google rating/count will be used from Places APIs and refreshed periodically.
- Combined rating uses weighted average by rating counts (not simple mean of two averages).
- Owner account type is chosen at signup (single-role model for MVP).
- Google-only restaurants can appear in feed even if not yet claimed by an owner.

## 13) Suggested Next Step
After you confirm or edit this requirements file, the next deliverable will be:
- Technical design (`architecture.md`) and
- Initial scaffold implementation plan (frontend + backend + DB + API contracts).
