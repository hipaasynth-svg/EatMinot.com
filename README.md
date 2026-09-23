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
| `admin.html` | Operator admin (upload photos, toggle Claimed/Paid, hand out setup codes) |
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
  - The **Rolodex** (home carousel, 47 live Minot restaurants of 52 seeded — the rest are
    held back via the `REMOVED` id-map pending a photo) is a lean teaser —
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
  so a reload or wiped cache can restore it. Customers can **Add card to Google Wallet** or
  **Add to Apple Wallet**; each pass carries the punch balance and a QR that reopens the
  card (`?dev=<token>`), so a new phone re-links to the same card. The **Google** card also
  **auto-updates** after each punch (server-side patch). The **Apple** `.pkpass` is generated
  and signed on the fly (`/api/pass?provider=apple`, served as `application/vnd.apple.pkpass`);
  its balance is baked in at add-time, so re-adding refreshes it (live push-update via APNs is
  a later step). Both are env-gated (see below); with no wallet env the buttons don't render
  and everything else works unchanged. Apple signing shells out to the system `openssl`
  (present on Vercel's Node runtime).
- **Neon "Happy Hour Now"** indicator that switches on/off by the clock from the
  owner's schedule (day + start/end + special).
- **Owner dashboard** (password-gated) — Restaurant's Choice billboard (top 3 picks),
  happy-hour selector, punch-card reward, note, website, password change. A "forgot
  password" line points owners to `cody@eatminot.com`.
- **Paid gate** — changing the photo and publishing the billboard require the $59/mo
  tier; free claimed owners can edit the rest.
- **Admin console** — upload a photo for any restaurant, toggle Claimed/Paid, add to
  "Minot's Most Wanted", **hide/show a restaurant** (pulls it from the public list, tag
  page, Most Wanted and rating while keeping it in the admin panel to restore), **edit a
  venue's address & hours** inline (or **Refresh hours from directory** to push the built-in
  address/hours onto every saved profile at once — handy in shared mode, where a code deploy
  alone won't overwrite the stored copy; it touches only address/hours, never flags or
  photos), hand out a listing’s setup code or generate a new owner password, copy each restaurant’s
  tag URL, reset demo data. No admin action writes to a vote counter — those only move via a real rating.

### Owner onboarding (no default passwords)
There is deliberately **no formula that turns a restaurant's name into its credential**,
and no password is seeded for any listing. A restaurant is onboarded like this:

1. The admin console shows that listing's **setup code** — a random 8-character code,
   generated once per venue and stored on its profile. Hand it over with the tags (the
   "Copy setup link" button gives you `/?owner=<id>&c=<code>` for the packet QR).
2. The owner opens that link, enters the setup code, and picks their own password. That
   claims the listing, and the code is spent.
3. After that, only their password works. A listing nobody has claimed cannot be logged
   into at all — there is no password on it to guess.

If an owner loses their password, an admin generates a new random one from the console
(shown once — only the salted hash is stored). If a setup card goes astray before the
listing is claimed, "New code" issues a fresh code and invalidates the old one. Owners
can email `cody@eatminot.com`.

> An earlier version seeded every listing with its name + `26` and this file published the
> formula, which meant any listing could be logged into by anyone who could read its name.
> `tests/auth.test.js` covers that case specifically so it cannot come back.

- **Admin password:** set `EAT_ADMIN_PASSWORD` in Vercel. There is a development fallback
  in `api/_lib.js` for local use; **treat any deployment without that variable set as an
  open admin console** and set it before going live.

## Verified presence — signed tags, server-held punches, single-use rewards

The three things that make "verified word-of-mouth" true are enforced on the server, not
in the customer's browser:

1. **A rating needs a signed tag.** Tag URLs are `/?r=<id>&t=<sig>`, where `sig` is an
   HMAC of the venue id under `EAT_TAG_SECRET`. It is deterministic, so a venue's tag URL
   never changes and a printed tag never goes stale unless you rotate the secret. Copy the
   current URL per venue from the admin console.
2. **One rating per device per venue per 24h**, as a Redis claim keyed on the device's
   anonymous `dev_…` token. Clearing site data no longer resets it.
3. **Punches are counted server-side** and a reward is minted as a server record. The
   client cannot write its own progress — `/api/device` is read-only and its old `put`
   action answers `410`.

### Rolling out signed tags without breaking the tags already in venues

Tags printed before this carry a bare `/?r=<id>`, so enforcement is **off by default**:

1. Set `EAT_TAG_SECRET` in Vercel to a long random string and redeploy. Signed URLs start
   being issued; unsigned ratings are still accepted but marked unverified.
2. Reprint or reprogram each tag from the admin console (each row shows its signed link
   with a copy button). The admin banner tells you which phase you are in.
3. Once every tag is updated, set `EAT_REQUIRE_TAG_SIG=1`. Unsigned ratings are now
   refused. Any tag still carrying a bare link stops working — that is the point.

> Rotating `EAT_TAG_SECRET` invalidates every printed tag at once. Only do it if a secret
> leaks, and reprogram everything in the same sitting.

## Rewards: earned, added to Wallet, redeemed once

- Filling a card mints a coupon as a **server record** — code, venue, reward, expiry,
  `redeemedAt`. The code used to be generated in the browser and never sent anywhere, so
  nothing could tell a real one from a string typed into a notes app and the same code
  worked until it expired.
- The customer can **Add reward to Google Wallet**. It is a separate Google *Offer* pass
  beside the punch card, carrying a QR that opens `/redeem?c=<code>`.
- **Any staff member redeems it from their own phone.** They scan that QR (or open the
  "Staff: redeem" link on the customer's screen), which shows the venue and the reward,
  then enter the venue's **6-digit staff PIN**. No app, no venue login, no shared device —
  the PIN is the authorisation, so a passer-by who scans the same QR cannot spend
  someone else's reward.
- On success the coupon is burned (it cannot be redeemed twice) and the Wallet pass is
  PATCHed to `COMPLETED`, so it **greys out in the customer's own Wallet**. The pass
  becomes the receipt.
- The owner sets and rotates the staff PIN in their dashboard; it is hashed at rest and
  never readable back. **A venue with no PIN cannot redeem at all** — deliberately, rather
  than falling back to something guessable.
- Because the endpoint is public, failed PINs are rate-limited per coupon, per venue and
  per IP, and a coupon locks out long before a six-digit PIN could be walked.
- Admin → the per-venue **issued vs redeemed** line. Derived by scanning the coupon
  records, so it cannot drift from them.

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
   `EAT_ADMIN_PASSWORD` — required before going live; see "Owner onboarding" above.)

Photos are stored under separate Redis keys and downscaled client-side to keep them small.

### API surface (`/api`)
- `GET  /api/state` → public restaurants (+ `persistent` flag), no passwords
- `POST /api/rate` `{id, t, deviceId, stars, upvote}` → verifies the tag signature and the
  once-per-day claim, updates the shared counters, advances the server-held punch card,
  and mints a coupon when it fills
- `POST /api/coupon` `{action:'peek'|'redeem'|'mine'|'walletLink', …}` → staff-facing
  lookup, single-use PIN redemption, a device's own rewards, and the Add-to-Wallet link
- `POST /api/owner` `{action:'login'|'update'|'photo', id, password, …}` → owner controls
- `POST /api/admin` `{password, action, …}` → photos, Claimed/Paid flags, list, reset
- `GET  /api/photo?id=` → a restaurant's photo
- `POST /api/device` `{action:'get', deviceId}` → read-only punch state for that anonymous
  token. `put` is gone (410): the server owns the count
- `GET  /api/pass` → `{google, apple}` (which wallet buttons the server can issue)
- `GET  /api/pass?provider=apple&dev=&venueId=&done=&total=` → the signed `.pkpass` file
- `POST /api/pass` `{provider, dev, venueId, done, total}` → an Add-to-Wallet save link

## Owner auth (server-side)

In shared mode, owner passwords are **salted-SHA-256 hashed** in the database (no plaintext
at rest). Logging in returns a **signed HMAC session token** (12h), which is what subsequent
owner edits/photo uploads send — the password isn't re-transmitted on every action. Set
`EAT_SESSION_SECRET` in Vercel to a long random string so tokens can't be forged. If it's
ever left unset, the code signs with a random secret generated fresh per cold start instead
of a fixed fallback — an unset secret just logs owners out on redeploy, never a silent hole.

The admin console never shows password hashes, and there is no default password to show.
For an unclaimed listing it shows that venue's **setup code**; for a claimed one it shows
only whether a password has been set, with a **Generate new password** action that returns
a fresh random password once.

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
| `EAT_ADMIN_PASSWORD` | The admin-console password. **Set this before going live.** |
| `STRIPE_SECRET_KEY` | Live $59/mo Stripe checkout |
| `STRIPE_WEBHOOK_SECRET` | Auto status sync (cancellations) |
| `STRIPE_PRICE_ID` | Use a fixed Stripe Price instead of the inline $59/mo |
| `GOOGLE_WALLET_ISSUER_ID` | Google Wallet punch-card passes (with the SA key below) |
| `GOOGLE_WALLET_SA_JSON_BASE64` | Google service-account JSON key, base64-encoded |
| `APPLE_PASS_TYPE_ID` / `APPLE_TEAM_ID` / `APPLE_PASS_CERT_P12_BASE64` / `APPLE_PASS_CERT_PASSWORD` / `APPLE_WWDR_CERT_BASE64` | Apple Wallet passes (all five required; button hidden until then) |
| `EAT_TAG_SECRET` | Signed tag URLs (`/?r=<id>&t=<sig>`). **Set this** — without it, presence can't be proven or enforced. |
| `EAT_REQUIRE_TAG_SIG` | Set to `1` to **refuse** ratings without a valid tag signature. Reprogram every tag first (see below). |
| `MINOT_AGENT_URL` / `MINOT_AGENT_SERVICE_KEY` | AI Assistant (beta) — proxies `api/agent.js` to the self-hosted [`minot-agent`](https://github.com/hipaasynth-svg/hipaasynth-svg-minot-agent) service. Also requires an admin to flip a venue's `agentEnabled` flag in the admin console; without either, the feature stays invisible. |

### AI Assistant (beta)
An experimental, admin-gated "AI co-pilot" per venue — writes and runs Python in a
kernel-sandboxed worker (no network access from generated code) to help fill seats
and turn ratings into reviews. Lives entirely in a separate service
([`minot-agent`](https://github.com/hipaasynth-svg/hipaasynth-svg-minot-agent)) this site only
talks to over HTTP via `api/agent.js`; this repo holds no agent code, no LLM
credentials, and no operator data beyond the one venue's own public listing. Off
by default — a super admin turns it on per venue (`admin.html` → "AI Assistant"
chip) once `minot-agent` is deployed and its URL/key are set above.

### Remaining for later
- **Owner accounts by email** (magic-link / OAuth) would replace the per-restaurant password
  entirely — a further step needing an email or auth provider.
- **Domain**: add `eatminot.com` in the project's Domains tab and point DNS to Vercel.

## Public repo — nothing sensitive lives here

All secrets (`STRIPE_SECRET_KEY`, `EAT_SESSION_SECRET`, `EAT_ADMIN_PASSWORD`, the Upstash
Redis credentials) are Vercel environment variables — never committed. There is nothing in
this repository that needs to be private for the app itself to be secure.
