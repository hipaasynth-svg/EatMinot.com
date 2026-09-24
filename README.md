# EatMinot

**Verified local restaurant ratings for Minot, North Dakota.** A rating is only possible
after a physical tap — NFC or QR, on a tag that lives inside the restaurant. No accounts,
no email capture, no tracking, no way to rate from your couch.

**47 restaurants live. Shared database attached. Stripe billing live. Running on Vercel.**

---

## The problem this solves

Every review platform in existence has the same hole: anyone can rate anything from
anywhere. A competitor can bury you from a laptop in another state. A bot can bury you a
hundred times. An owner can pad their own score. The score becomes noise, and everyone
knows it, which is why nobody trusts it.

EatMinot closes the hole at the source. **You cannot rate a restaurant you have not
physically walked into.** The only path to the rating screen is tapping that restaurant's
own tag, and the tag is signed with an HMAC key so the URL cannot be forged or shared.
One rating per device per restaurant per 24 hours.

What you get is a number that actually means something: *this many real people were
actually here and actually liked it.*

---

## What is live right now

Verified against the running Vercel configuration, not aspirational:

| | EatMinot |
|---|---|
| Restaurants live | **47** (of 52 seeded; 5 held back pending a photo) |
| Shared database | **Attached** — Upstash Redis, every visitor sees the same data |
| Owner dashboards | **Live** — claim code → password → billboard, happy hour, reward, photo |
| Stripe billing | **Live keys + webhook**, $79/mo standard and $59/mo founding |
| Signed tags | **Key set** — signed URLs are being issued |
| Signature enforcement | **OFF** — see the one blocker below |
| Wallet passes | Not configured on this site (DrinkMinot has Google Wallet) |
| AI Assistant | Built, not wired to a service |
| Tests | **111 assertions across 4 suites**, plus a 146-check drift guard, on every PR |

### The one blocker that matters

`EAT_TAG_SECRET` is set, so tags are being signed. **`EAT_REQUIRE_TAG_SIG` is not set**,
which means `api/rate.js:40` still accepts a rating that arrives with no valid signature.

Right now, the single sentence this whole product is sold on is **not enforced in
production.** It is one environment variable away from being true — but flipping it breaks
every tag already printed with a bare `/?r=<id>` link, so the tags have to be reprogrammed
first. The sequence is in [docs/DEPLOY.md](docs/DEPLOY.md#rolling-out-signed-tags).

Until that flag is on, treat "verified presence" as the design, not the guarantee.

---

## How it works

**1. A diner taps the tag.** The NFC tag or QR code on the table opens straight to that
restaurant's page — no carousel, no browsing, no other listings competing for the moment.
A bouncing *"Swipe up to rate"* prompt is waiting.

**2. Two taps and they're done.** Thumbs-up, then a star. There is deliberately **no
thumbs-down** — a "submit stars only, no upvote" option lets someone rate quality honestly
after a bad night without torching the place. A "PUNCHED" starburst fires on submit.

**3. They earn something.** Every rating is a punch on that restaurant's card. Fill it and
a single-use reward coupon is issued, redeemable only with a 6-digit staff PIN — so the
reward cannot be screenshotted, forwarded, or claimed twice.

**4. The owner runs it themselves.** A password-protected dashboard: the Restaurant's
Choice billboard (their top 3 picks), happy-hour window and special, reward settings,
photo, note, website. Changes go live immediately for every customer.

The punch card only goes live once the venue has confirmed they'll honor the reward. The
system does not print a promise somebody else has to keep.

---

## The offer

| | Standard | Founding Three |
|---|---|---|
| **Rate** | $79/month | **$59/month** |
| **Trial** | none, billed immediately | **10 weeks free** |
| **Availability** | anyone | **3 restaurants, ever** |

Both amounts live in exactly one place — `STANDARD_PRICE_CENTS` and
`FOUNDING_PRICE_CENTS` in `api/_lib.js` — and CI fails if any pamphlet, label or page
disagrees with them, or if the founding rate ever stops being the cheaper one.

The founding rate is **not** advertised as locked for a year. Nothing in the code enforces
a locked term, so nothing printed promises one.

**Paid unlocks** photo changes and the Restaurant's Choice billboard. A free claimed owner
can still edit everything else.

---

## Known gaps

Stated plainly, because a README that hides these is how the pricing bug happened:

- **Signature enforcement is off.** The core claim is unenforced until the tags are
  reprogrammed and the flag is flipped. Above.
- **Owners see almost no proof it worked.** Rating counts, coupons issued and coupons
  redeemed are all sitting in Redis today, but `couponStats` is admin-only
  (`api/admin.js`), so the person paying $79 cannot see the number that justifies it.
  There is no tap counter and nothing time-series, so "this month vs last" is impossible.
  This is the highest-value thing left to build.
- **Seed placeholders.** 15 of the 47 rows in `RAW` carry `"Verify hours"` and 3 carry
  `"Minot, ND"` instead of a street. These are the *fallback* values a listing starts from,
  not necessarily what the site serves: a stored profile keeps its own `hours` and `address`
  (`normalizeProfile` backfills only `category`, `over21` and `alsoOnEat`), so anything
  corrected through the admin editor — `setInfo` in `api/admin.js` — overrides them
  permanently. Check the live `/api/state` for what is actually being served; don't read
  `seedProfile()` and call it production, which is a mistake this file previously made.
  Missing street addresses no longer affect directions either way: the button falls back to
  the venue name, which Google Maps resolves.
- **No failed-payment handling.** `api/stripe-webhook.js` covers cancellation but not
  `invoice.payment_failed`, so an expired card keeps every paid feature until Stripe
  eventually cancels.
- The full standing audit is in [docs/AUDIT.md](docs/AUDIT.md).

---

## Run it

```sh
npm test         # 111 assertions, 4 suites, zero dependencies
npm run drift    # 146 consistency checks against the DrinkMinot twin
```

No install step — everything uses Node builtins only. Open `index.html` for the customer
experience, `admin.html` for the operator console.

**Deployment, environment variables, the API surface, the signed-tag rollout, Stripe setup
and how the twin sites are kept in sync: [docs/DEPLOY.md](docs/DEPLOY.md).**

---

## Sibling site

[**DrinkMinot**](https://github.com/hipaasynth-svg/drinkminot) is the same system for bars,
bottle shops and coffee — 29 venues, Google Wallet passes live, and the same offer at the
same price. The two are kept honest by a shared drift guard that fails CI if their pricing,
trial length or slot cap ever diverge.

## This repo is public on purpose

Every secret — Stripe keys, session and tag secrets, the admin password, the Redis
credentials — is a Vercel environment variable, never committed. There is nothing here that
needs to be private for the system to be secure. That is a deliberate property, not an
accident: the security of this app does not depend on hiding its source.
