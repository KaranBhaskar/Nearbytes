# Backend

This repo's backend is the Convex app.

Source of truth:

- `convex/` for database schema, queries, mutations, and actions

Required backend environment variables on Convex:

- `GOOGLE_MAPS_API_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` optional, defaults to `gemini-2.5-flash-lite`

Recommended deployment flow:

1. Log in with `npx convex dev` locally if needed
2. Push backend changes with `npx convex deploy`
3. Keep production-only secrets in the Convex dashboard or via `npx convex env set`
