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
- **Rating is tag-only.** There is no rating control anywhere in general browsing — the
  only way to rate a restaurant is to tap its physical NFC tag or scan its QR code
  (`/?r=<id>`, shown per-restaurant in the admin console with a copy button), which opens
  straight to that restaurant's full detail page: no carousel, no other cards. A bouncing
  **"Swipe up to rate"** prompt opens the rating overlay there; once rated it's replaced by
  a "✓ Rated" confirmation. "Browse all →" leaves for the normal app. This enforces
  "verified presence only" at the UI level, not just as a policy.
- **Two views of each restaurant, split by purpose:**
  - The **Rolodex** (home carousel, 39 seeded Minot restaurants) is a lean teaser —
    name, hours, the happy-hour cue, and verified-rating count only. Smooth momentum
    drag with a click-vibration on each turn (arrow keys / edge buttons on desktop).
  - The **tag/QR detail page** carries everything else: address, the Restaurant's Choice
    billboard, happy-hour special text, punch-card progress, and any earned coupon —
    the page a tap or scan actually lands on.
- **Two-tap rating** — thumbs-up then a star (left = lower, right = higher). Because
  there is **no thumbs-down**, a "Submit stars only — no upvote" option lets people
  rate quality after a bad experience without upvoting. Brief "PUNCHED" starburst on
  submit; one rating per device per restaurant / 24h.
- **Punch card** — an owner-set number of punches (2–5) earns a restaurant-set reward,
  then it resets and issues a short redemption code with an expiry.
- **Wallet passes + card backup** — progress lives per-device, but in shared mode it is
  also mirrored to the backend under the device's random token (no name/email/account),
  so a reload or wiped cache can restore it. Customers can **Add card to Google Wallet**;
  the pass carries the punch balance and a QR that reopens the card (`?dev=<token>`), so a
  new phone re-links to the same card. Google is env-gated (see below); Apple is wired
  through and lights up once its certs are set. With no wallet env, the buttons simply
  don't render and everything else works unchanged.
- **Neon "Happy Hour Now"** indicator that switches on/off by the clock from the
  owner's schedule (day + start/end + special).
- **Owner dashboard** (password-gated) — Restaurant's Choice billboard (top 3 picks),
  happy-hour selector, punch-card reward, note, website, password change. A "forgot
  password" line points owners to `cody@eatminot.com`.
- **Paid gate** — changing the photo and publishing the billboard require the $59/mo
  tier; free claimed owners can edit the rest.
- **Admin console** — upload a photo for any restaurant, toggle Claimed/Paid, view/hand
  out owner passwords (or reset one to default), copy each restaurant's tag URL, reset
  demo data. No admin action writes to a vote counter — those only move via a real rating.

### Default credentials
- **Owner login:** pick your restaurant, password = its name (letters only) + `26`
  (e.g. `thestarvingrooster26`). Changeable in the dashboard; each password is listed
  in the admin console. Owners who lose it can email `cody@eatminot.com`.
- **Admin:** `minot-admin` (changeable inside the admin console / `EAT_ADMIN_PASSWORD`).

## Shared database (turn on cross-device sync)

The app runs in two modes automatically:

- **Local mode** (default before setup): data lives in each browser's `localStorage`.
  The site fully works, but owner edits/photos/ratings are per-device.
- **Shared mode**: once a Redis store is attached, `GET /api/state` reports
  `persistent:true` and the app reads/writes the shared database — every visitor sees
  the same ratings, photos, and owner content.

The backend is plain Vercel serverless functions in `api/` (no npm dependencies). They
talk to an Upstash Redis store using either `UPSTASH_REDIS_REST_URL`/`_TOKEN` (Vercel's
Marketplace "Upstash for Redis" integration) or the legacy `KV_REST_API_URL`/`_TOKEN` —
whichever Vercel injects when you attach the store.

**Storage is per-restaurant, not one shared blob.** Each restaurant has its own profile
key (`eatminot:r:<id>`) and its own vote-counter hash (`eatminot:v:<id>`). Votes move only
via Redis `HINCRBY` — an atomic, race-free increment — so many simultaneous ratings for
the same restaurant can't lose an update the way a read-modify-write on shared state could.
`GET /api/state` fetches every restaurant in a single round trip via Upstash's pipeline
endpoint, so this costs nothing extra on page load.

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
- `POST /api/device` `{action:'get'|'put', deviceId, perRest}` → anonymous punch-card backup
  (keyed only by the random `dev_…` token; sanitized to punch/coupon fields; no identity)
- `GET  /api/pass` → `{google, apple}` (which wallet buttons the server can issue)
- `POST /api/pass` `{provider, dev, venueId, done, total}` → an Add-to-Wallet save link

## Owner auth (server-side)

In shared mode, owner passwords are **salted-SHA-256 hashed** in the database (no plaintext
at rest). Logging in returns a **signed HMAC session token** (12h), which is what subsequent
owner edits/photo uploads send — the password isn't re-transmitted on every action. Set
`EAT_SESSION_SECRET` in Vercel to a long random string so tokens can't be forged. If it's
ever left unset, the code signs with a random secret generated fresh per cold start instead
of a fixed fallback — an unset secret just logs owners out on redeploy, never a silent hole.

The admin console never shows password hashes: it shows each owner's **default** password
(name + `26`) and flags any that an owner has changed, with a one-click **Reset to default**.

## Billing — $59/mo Claimed tier (Stripe)

The "Upgrade — $59/mo" button opens **Stripe Checkout** (subscription). On return, the app
confirms the session and flips the listing to **Paid** (unlocking photo changes + the
Restaurant's Choice billboard). A webhook keeps status in sync on cancellation.

Implemented with Stripe's REST API directly (no SDK): `api/checkout.js`,
`api/upgrade-confirm.js`, `api/stripe-webhook.js`.

### Setup in Vercel
1. Add environment variables:
   - `STRIPE_SECRET_KEY` — from your Stripe dashboard (test or live).
   - `STRIPE_WEBHOOK_SECRET` — from the webhook you create in step 2 (optional but
     recommended; without it, upgrades still work via return-confirmation, but automatic
     downgrade-on-cancel won't).
   - `STRIPE_PRICE_ID` — *optional*. If unset, checkout creates the $59/mo line inline; set
     it to a fixed Price ID if you'd rather manage the product in Stripe.
2. In Stripe → Developers → **Webhooks**, add an endpoint `https://eatminot.com/api/stripe-webhook`
   for events `checkout.session.completed`, `customer.subscription.deleted`,
   `customer.subscription.updated`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Redeploy. Until `STRIPE_SECRET_KEY` is set, the upgrade button reports "billing not set
   up" and you can still grant Paid manually from the admin console.

## Environment variables (all optional; features light up when present)

| Var | Enables |
|-----|---------|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Shared database (auto-added by Vercel's Upstash Redis) |
| `EAT_SESSION_SECRET` | Unforgeable owner session tokens |
| `EAT_ADMIN_PASSWORD` | Overrides the `minot-admin` admin default |
| `STRIPE_SECRET_KEY` | Live $59/mo Stripe checkout |
| `STRIPE_WEBHOOK_SECRET` | Auto status sync (cancellations) |
| `STRIPE_PRICE_ID` | Use a fixed Stripe Price instead of the inline $59/mo |
| `GOOGLE_WALLET_ISSUER_ID` | Google Wallet punch-card passes (with the SA key below) |
| `GOOGLE_WALLET_SA_JSON_BASE64` | Google service-account JSON key, base64-encoded |
| `APPLE_PASS_TYPE_ID` / `APPLE_TEAM_ID` / `APPLE_PASS_CERT_P12_BASE64` / `APPLE_PASS_CERT_PASSWORD` / `APPLE_WWDR_CERT_BASE64` | Apple Wallet passes (all five required; button hidden until then) |

### Remaining for later
- **Owner accounts by email** (magic-link / OAuth) would replace the per-restaurant password
  entirely — a further step needing an email or auth provider.
- **Domain**: add `eatminot.com` in the project's Domains tab and point DNS to Vercel.

## Public repo — nothing sensitive lives here

All secrets (`STRIPE_SECRET_KEY`, `EAT_SESSION_SECRET`, `EAT_ADMIN_PASSWORD`, the Upstash
Redis credentials) are Vercel environment variables — never committed. There is nothing in
this repository that needs to be private for the app itself to be secure.
