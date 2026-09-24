# Deploying and operating EatMinot

Everything needed to run, configure and operate the site. The [README](../README.md)
covers what the product is and what is live; this is the plumbing.

**Verified live configuration as of 2026-09-23** (read from the Vercel project, names only
— no values were decrypted):

| Variable | State | Effect |
|---|---|---|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` / `KV_URL` / `REDIS_URL` | **set** | Shared mode is on; Upstash Redis attached |
| `EAT_SESSION_SECRET` | **set** | Owner session tokens are unforgeable |
| `EAT_ADMIN_PASSWORD` | **set** (production) | Admin console is not on a default password |
| `STRIPE_SECRET_KEY` | **set** | Checkout is live |
| `STRIPE_WEBHOOK_SECRET` | **set** | Cancellations sync automatically |
| `STRIPE_PRICE_ID` | **not set** | Good — the inline `STANDARD_PRICE_CENTS` ($79) is authoritative. See the warning below before ever setting it. |
| `EAT_TAG_SECRET` | **set** | Signed tag URLs are being issued |
| `EAT_REQUIRE_TAG_SIG` | **not set** | ⚠️ Unsigned ratings are still **accepted** — presence is not enforced |
| Apple / Google Wallet vars | **not set** | Add-to-Wallet button stays hidden on this site |
| `MINOT_AGENT_URL` / `MINOT_AGENT_SERVICE_KEY` | **not set** | AI Assistant stays invisible |

---

## Live app (static, deploys to Vercel with zero config)

| File | Purpose |
|------|---------|
| `index.html` | Public app + owner login + owner dashboard |
| `admin.html` | Operator admin (upload photos, toggle Claimed/Paid, hand out setup codes) |
| `store.js`   | Shared data model, seed list, persistence, helpers |

Open `index.html` for the customer experience; `admin.html` for the operator console.

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

### Rolling out signed tags

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

## Shared database (attached — Upstash Redis)

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

### How it was set up (already done — for reference or a second environment)
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
- `api/device.js` is gone. Its one read-only action is now
  `POST /api/coupon {action:'deviceGet', deviceId}`, because Vercel's Hobby plan caps a
  deployment at **12 Serverless Functions** and a whole file for one read spent one of
  them. Nothing writes punch state except a real rating.
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

## Billing — two tiers (Stripe)

| Tier | Price | Trial | How a venue gets it |
|------|-------|-------|---------------------|
| **Standard** | **$79/mo** | none — billed immediately | Any claimed owner clicks "Upgrade — $79/mo" |
| **Founding Three** | **$59/mo** | **10 weeks free**, then $59/mo | An admin grants it in the console — 3 slots on this site, ever |

Both amounts live in exactly one place: `STANDARD_PRICE_CENTS` and `FOUNDING_PRICE_CENTS`
in `api/_lib.js`. That is what Stripe is actually charged. The `PRICING` object near the top
of `index.html`'s owner-dashboard script holds the matching owner-facing *labels* — change a
rate in both, and nowhere else. `tests/founding.test.js` asserts the table above and fails
if the founding rate ever stops being cheaper than standard, which is the bug it exists to
prevent: the offer shipped priced *above* standard and stayed that way while it was being
sold.

The upgrade button opens **Stripe Checkout** (subscription). On return, the app confirms the
session and flips the listing to **Paid** (unlocking photo changes + the Restaurant’s Choice
billboard). A webhook keeps status in sync on cancellation.

### Founding Three
Exactly **3 venues on this site** can ever hold the offer. An admin grants it with the
**Founding** chip in the console. The cap is enforced twice — at grant time
(`api/admin.js` `setFlag`, which returns `409 founding_full`) and again at checkout
(`api/checkout.js`) — so two granted venues checking out at the same moment cannot both
take the last slot.

Only the first checkout that actually redeems the offer gets the free trial. Once it
completes, `founding` is set permanently, so a venue that later cancels and resubscribes
keeps the $59 rate but does **not** get a second trial.

**On "locked for a year":** `foundingLockUntil` is written (one year out) but **nothing
reads it**, and no owner-facing copy promises a locked rate — deliberately. If you want to
advertise a locked rate, add the guard that enforces it *first*. A pricing promise no code
can keep is a liability, not a feature.

Implemented with Stripe's REST API directly (no SDK): `api/checkout.js`,
`api/upgrade-confirm.js`, `api/stripe-webhook.js`.

### Setup in Vercel
1. Add environment variables:
   - `STRIPE_SECRET_KEY` — from your Stripe dashboard (test or live).
   - `STRIPE_WEBHOOK_SECRET` — from the webhook you create in step 2 (optional but
     recommended; without it, upgrades still work via return-confirmation, but automatic
     downgrade-on-cancel won't).
   - `STRIPE_PRICE_ID` — *optional*, **standard tier only**. If unset, checkout creates the
     $79/mo line inline; set it to a fixed Price ID if you'd rather manage the product in
     Stripe. Founding checkouts ignore it — they always need their own dynamic price so the
     10-week trial can be attached.

     > ⚠️ **Verified 2026-09-23: this is NOT set, which is the correct state.** Leave it
     > that way. If it is ever set, it overrides `STANDARD_PRICE_CENTS` and decides what the
     > standard tier is actually charged — and the amount lives in Stripe, not in this repo,
     > so nothing here (not `tests/founding.test.js`, not the constants, not the drift
     > guard) can detect a mismatch. A Price object created back when standard was $59 would
     > keep charging $59 while every document, pamphlet and label said $79. Keeping it unset
     > makes the inline `STANDARD_PRICE_CENTS` the single source of truth.
2. In Stripe → Developers → **Webhooks**, add an endpoint `https://eatminot.com/api/stripe-webhook`
   for events `checkout.session.completed`, `customer.subscription.deleted`,
   `customer.subscription.updated`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Redeploy. Until `STRIPE_SECRET_KEY` is set, the upgrade button reports "billing not set
   up" and you can still grant Paid manually from the admin console.

## Keeping the two sites in sync

EatMinot and DrinkMinot are twins: near-identical code sold as one offer at one price. Every
fix has to be ported twice, and when a port is missed nobody notices until a customer does.
That has already happened three ways — the founding tier priced *above* standard while the
pamphlets sold it as a discount, a one-pager selling "Founding Five" against a cap of 3, and
`store.js` silently dropping an admin flag so a console toggle did nothing.

`scripts/drift-guard.js` is the guard against a fourth. Run it locally:

```sh
npm test         # the regression suites
npm run drift    # self-consistency + comparison against the twin checkout
```

A byte diff between the twins is useless (they legitimately differ by hundreds of lines), so
the guard checks **invariants** instead:

- the founding rate always **undercuts** standard — the invariant that actually broke
- `api/checkout.js` carries no bare rate literal; both amounts come from the constants
- `index.html`'s `PRICING` labels match `STANDARD_PRICE_CENTS` / `FOUNDING_PRICE_CENTS`, and
  its trial label matches `FOUNDING_TRIAL_DAYS`
- every rate stated in owner-facing HTML is one of the two current rates, and every
  "Only N spots" / "Founding <Word>" claim matches `FOUNDING_LIMIT`
- no owner-facing page promises a locked rate, since nothing in the code enforces one
- every boolean flag `api/admin.js` `setFlag` accepts is actually forwarded by `store.js`
  `adminSetFlag` — the no-op-toggle bug class
- the four shared constants are **identical** in both repos, and the two copies of the guard
  are byte-identical, so the guard cannot itself drift

`.github/workflows/ci.yml` runs the suites and the guard on every PR. It clones the twin at
the *same branch name* when one exists, falling back to `main`, so a change that correctly
updates a shared invariant in both repos verifies against its counterpart instead of failing
until one side merges.

The banned-phrase check is matched literally and does not try to detect negation, so
owner-facing copy should avoid "locked for a year" even to deny it. The reasoning for not
promising a lock lives here and in `docs/AUDIT.md`, which the guard does not scan.

## Environment variables (full reference)

| Var | Enables |
|-----|---------|
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Shared database (auto-added by Vercel's Upstash Redis) |
| `EAT_SESSION_SECRET` | Unforgeable owner session tokens |
| `EAT_ADMIN_PASSWORD` | The admin-console password. **Set this before going live.** |
| `STRIPE_SECRET_KEY` | Live Stripe checkout (both tiers) |
| `STRIPE_WEBHOOK_SECRET` | Auto status sync (cancellations) |
| `STRIPE_PRICE_ID` | Use a fixed Stripe Price for the **standard** tier instead of the inline $79/mo (founding checkouts always use the dynamic price + trial) |
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
