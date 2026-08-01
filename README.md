# EatMinot.com

Local restaurant ratings for Minot, ND — by locals, for locals.

**Tap. Rate. Earn. Zero tracking. Period.**

Verified word-of-mouth made measurable and fair. Ratings are only possible after a
physical presence check (NFC tap or QR scan of a unique in-store tag), one per device
per restaurant every 24 hours. No accounts, no email/text collection, no personal tracking.

## Live app (static, deploys to Vercel with zero config)

| File | Purpose |
|------|---------|
| `index.html` | Public app + owner login + owner dashboard |
| `admin.html` | Operator admin (upload photos, toggle Claimed/Paid, see owner passwords) |
| `store.js`   | Shared data model, seed list, persistence, helpers |

Open `index.html` for the customer experience; `admin.html` for the operator console.

### What works today
- **Swipeable Rolodex** of 30 seeded Minot restaurants — smooth momentum drag with a
  click-vibration on each turn (arrow keys / edge buttons on desktop).
- **Two-tap rating** — thumbs-up then a star (left = lower, right = higher). Because
  there is **no thumbs-down**, a "Submit stars only — no upvote" option lets people
  rate quality after a bad experience without upvoting. Brief "PUNCHED" starburst on
  submit; one rating per device per restaurant / 24h.
- **Punch card** — 10 punches = a restaurant-set reward, then it resets and issues a
  short redemption code with an expiry.
- **Neon "Happy Hour Now"** indicator that switches on/off by the clock from the
  owner's schedule (day + start/end + special).
- **Owner dashboard** (password-gated) — Restaurant's Choice billboard (top 3 picks),
  happy-hour selector, punch-card reward, note, website, password change.
- **Paid gate** — changing the photo and publishing the billboard require the $59/mo
  tier; free claimed owners can edit the rest.
- **Admin console** — upload a photo for any restaurant, toggle Claimed/Paid, view/hand
  out owner passwords, reset demo data.

### Default credentials
- **Owner login:** pick your restaurant, password = its name (letters only) + `26`
  (e.g. `thestarvingrooster26`). Changeable in the dashboard; each password is listed
  in the admin console.
- **Admin:** `minot-admin` (changeable inside the admin console).

## Shared database (turn on cross-device sync)

The app runs in two modes automatically:

- **Local mode** (default before setup): data lives in each browser's `localStorage`.
  The site fully works, but owner edits/photos/ratings are per-device.
- **Shared mode**: once a Redis store is attached, `GET /api/state` reports
  `persistent:true` and the app reads/writes the shared database — every visitor sees
  the same ratings, photos, and owner content.

The backend is plain Vercel serverless functions in `api/` (no npm dependencies). They
talk to an Upstash Redis store using the standard `KV_REST_API_URL` / `KV_REST_API_TOKEN`
environment variables that Vercel injects when you attach the store.

### One-time setup in Vercel (~2 min)
1. Open your project → **Storage → Create Database → Upstash for Redis** (Marketplace) →
   connect it to this project. Vercel adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   automatically.
2. **Redeploy** (Deployments → ⋯ → Redeploy) so the functions pick up the new env vars.
3. Done — the app flips to shared mode on the next load. (Optional: set
   `EAT_ADMIN_PASSWORD` to change the admin password from the `minot-admin` default.)

Photos are stored under separate Redis keys and downscaled client-side to keep them small.

### API surface (`/api`)
- `GET  /api/state` → public restaurants (+ `persistent` flag), no passwords
- `POST /api/rate` `{id, stars, upvote}` → updates shared upvotes / verified ratings / stars
- `POST /api/owner` `{action:'login'|'update'|'photo', id, password, …}` → owner controls
- `POST /api/admin` `{password, action, …}` → photos, Claimed/Paid flags, list, reset
- `GET  /api/photo?id=` → a restaurant's photo

### Still placeholder (phase 2)
- **Client-side password checks / plaintext passwords** — good enough to gate owners, not
  bank-grade. A real auth provider is the next step.
- **The $59 upgrade button** — real Stripe billing is not yet wired; the admin console
  toggles Paid manually for now.

`Minot Eats.dc.html` is the earlier design-tool prototype, kept for reference.
