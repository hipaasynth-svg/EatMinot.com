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

### Known limits (phase 2 — needs a backend)
- **Storage is per-device** (browser `localStorage`). Owner edits and uploaded photos
  live in that browser; a shared database is needed for every customer to see them.
- **Password checks run client-side** — good enough to keep casual users out, not real
  security.
- **The $59 upgrade button is a placeholder** — real Stripe billing is not yet wired.

`Minot Eats.dc.html` is the earlier design-tool prototype, kept for reference.
