# Full audit — EatMinot / DrinkMinot / minot-agent

**Date:** 2026-09-22
**Method:** read the source, not the READMEs. Every claim below cites a file and line
and was verified by reading that code or running it. Where something can only be
confirmed against the live Vercel/Upstash config, it is marked **VERIFY LIVE** with
the exact check to run.

Commits audited:
- `EatMinot.com` @ `affae60`
- `drinkminot` @ `ac2214d`
- `hipaasynth-svg-minot-agent` @ `840176c`

---

## 0. Executive summary

The product works and the architecture is genuinely good: per-venue Redis keys,
atomic `HINCRBY` vote counters, hashed passwords, HMAC sessions, a real
kernel-sandboxed agent service. That is not the problem.

The problem is that **the one claim the whole business is sold on — "verified
ratings, no fake reviews, ever" — is not enforced anywhere on the server.** It is
enforced in the customer's own browser, in `localStorage`, behind a guessable URL
parameter. Anyone with `curl` can move any venue's rating as many times as they
like. A single owner or competitor discovering this ends the product's credibility
in a town of 48,000 people where everyone talks.

Second: **there is no measurement of anything.** No analytics, no tap counter, no
server-side record that a tag was ever scanned. An owner paying $59/month cannot be
shown a single number proving it worked, and you cannot see which venues are alive.
That is the classic local-SaaS churn killer, and it is also why you currently have
no way to price anything above $59.

Third: **the free tier is where all the cost is.** The `minot-agent` service needs
a dedicated VPS and LLM tokens, and it is gated by an admin toggle, not by Stripe.

Fixing #1 and #2 is roughly a week of work and everything else in the business
depends on both.

---

## 1. Severity 1 — attacks the exact claim you sell

### 1.1 `POST /api/rate` is unauthenticated, unthrottled, and accepts anything
`api/rate.js:8-27` (both sites, identical).

The handler validates only that `stars` is 1–5 and that the venue exists and is not
hidden. There is no session token, no tag token, no device identifier, no IP
throttle, no timestamp check, no nonce. The counters then move via `HINCRBY`, which
is atomic — meaning forged votes are recorded *reliably*.

```
# This is the entire attack. It needs no tag, no visit, no account.
while true; do
  curl -s -X POST https://eatminot.com/api/rate \
    -H 'Content-Type: application/json' \
    -d '{"id":1,"stars":5,"upvote":true}'
done
```

Venue ids are sequential 1-based integers and are **printed on the physical tags**
(`publicUrl()` → `/?r=<id>`, `index.html:742`), so no guessing is required either.

### 1.2 The "one rating per device per 24h" limit is client-side only
`store.js:391` — `rate()` starts with `if (ratedRecently(id)) return {ok:false}`, and
`ratedRecently` (`store.js:171`) reads `localStorage` key `eatminot_device_v1`. Clearing
site data, opening a private window, or calling the API directly all reset it. The
server has no concept of a device on the rating path at all.

### 1.3 The "verified presence" gate is a URL parameter
`index.html:566-568,724` — `tagVerified` is set from `?r=<id>` in the query string.
Typing `eatminot.com/?r=12` is indistinguishable from tapping venue 12's NFC tag.
Nothing is signed; there is no secret in the tag.

> **Net effect:** "Rating requires a physical NFC tap or QR scan — one per phone per
> day. No out-of-towners, no competitors, no bots" (`owner-pamphlet-trifold.html:219`)
> is not true of the deployed system. This is the sentence the $59 is sold on.

### 1.4 Any member of the public can log in as any venue owner
`api/_lib.js:79` `defaultPassword(name) = slug(name) + '26'` — and `seedProfile`
(`api/_lib.js:148`) sets **every** venue's password to that value, claimed or not.
`api/owner.js:17` `action:'login'` checks only `verifyPw`; it never checks `claimed`.

The formula is published in the public README ("password = its name (letters only) +
`26`, e.g. `thestarvingrooster26`"), and the venue names are on the public site.

```
curl -s -X POST https://eatminot.com/api/owner \
  -H 'Content-Type: application/json' \
  -d '{"action":"login","id":6,"password":"krollsdiner26"}'
# -> {"ok":true,"token":"<valid 12h owner session>"}
```

With that token an attacker can rewrite the venue's top picks, owner note, website,
reward, happy hour, and Most Wanted offer — and **change the password**, locking the
real owner out of their own listing (`api/owner.js:72`). Photo upload is the only
action gated behind `paid`.

### 1.5 Anyone can claim any unclaimed listing
`api/owner.js:24-31` — `action:'claim'` succeeds for any `id` whose profile has
`claimed === false`, with no proof of ownership. It sets the password and flips
`claimed`. Since `claimed` seeds true only for id 1, **every other venue on both
sites is claimable by the first stranger who posts to it.**

### 1.6 Admin console default password is published
`api/_lib.js:379` `ADMIN_DEFAULT = 'minot-admin'` (`'drink-admin'` on DrinkMinot),
both documented in the public READMEs, both overridable only by an env var that may
or may not be set. `checkAdmin` is a plain `===` string compare (not timing-safe —
minor next to the above).

**VERIFY LIVE, today:** in Vercel → each project → Settings → Environment Variables,
confirm `EAT_ADMIN_PASSWORD`, `DRINK_ADMIN_PASSWORD`, `EAT_SESSION_SECRET`, and
`DRINK_SESSION_SECRET` are all set. If the admin vars are unset, the full admin
console — photos, paid flags, every owner's default password, data reset — is open to
anyone who read the README.

### 1.7 No rate limiting on any endpoint, and no upload size cap
No endpoint in either `api/` directory implements throttling. `api/owner.js:36` and
`api/admin.js:54` check only that a photo `dataUrl` matches `/^data:image\//` — there
is no length check before it is written to Redis. An authenticated owner (see 1.4:
that means anyone) can push arbitrarily large base64 blobs into your Upstash store, a
direct bill-inflation path. `POST /api/device` (`api/device.js`) takes a
caller-supplied `deviceId` and writes to it with no authentication, so device records
are also freely writable.

---

## 2. Severity 1 — legal and regulatory exposure

### 2.1 The punch card rewards the *rating*, not the visit — incentivized reviews
`store.js:390-408`: `punch()` is called **only from inside `rate()`**. A customer
gets punch-card progress, and eventually a free item, in exchange for submitting a
rating. Combined with there being **no thumbs-down** (only "upvote" or "stars only"),
that is a reward contingent on leaving feedback on a system whose ratings are then
published as a consumer signal.

This is squarely in FTC review-guidance territory, and the irony is that the
`minot-agent` prompt library already refuses to help with it —
`minot_agent/experiments.py:60-66` hard-rules out "offering a discount or freebie in
exchange for a review". The core product does the thing its own AI refuses to do.

**The fix is small and it costs nothing:** award the punch on the *tap* (the verified
visit), and make the rating genuinely optional and unrewarded. `recordTap()` already
exists (`store.js:175`) and already fires on a real tag landing. Moving the `punch()`
call there, and out of `rate()`, converts the product from "paid for reviews" to
"loyalty card for visits, ratings welcome" — which is both legal and a better
product, because the ratings stop being bought.

### 2.2 DrinkMinot has no age gate, only a sticker
`drinkminot/index.html:330-331` — `over21` renders a decorative `21+` sticker. There
is no interstitial, no date-of-birth check, nothing that gates content or a
liquor-venue reward. A punch-card reward redeemable for alcohol, offered through an
ungated web app, is the highest-risk thing in either codebase.

### 2.3 ND liquor promotion law is unchecked
DrinkMinot ships a punch-card reward mechanic and a happy-hour broadcaster for bars,
casinos and liquor stores. Several states restrict or ban happy-hour discounting,
"free drink" rewards, and loyalty programs tied to alcohol. **Nothing in these repos
records that ND Century Code Title 5 and Minot city ordinance were checked.** This
needs a real answer before DrinkMinot signs a single bar, because the downside is a
venue's liquor licence, not yours — which is also how you lose the whole town.

### 2.4 Every unclaimed venue ships with a reward you invented
`api/_lib.js:157` seeds `reward: 'Free item when your punch card is full'` on every
venue. This is *correctly* gated — `rewardsOn` defaults from `claimed`
(`api/_lib.js:225`), so an unclaimed venue shows no punch card. That mitigation is
sound and should not be removed. Worth noting only because the string exists on all
47/29 profiles and one bad `setFlag` makes a promise a venue never agreed to.

---

## 3. Severity 2 — the business model gaps

### 3.1 You cannot prove ROI, because nothing is counted
Verified by grep across both repos: no analytics library, no pageview counter, no tap
counter, no scan counter, no impression counter, no redemption counter. `recordTap()`
writes to `localStorage` only and is never sent to the server. The device backup
(`api/device.js`) stores punch state but is never aggregated.

So the entire owner-visible evidence base for $59/month is a single number —
verified rating count — which is also the number they can't see move because of §1.

**What's missing is one Redis hash per venue per day.** Taps, unique devices, punch
cards filled, coupons issued, coupons redeemed, Most Wanted impressions. All
aggregate counters, no identity, fully compatible with "zero tracking" — you would
still be collecting strictly less than Google Analytics collects about a bounce.
Without it there is no monthly owner report, no renewal conversation, no upsell, and
no way for you to see which venues are dead.

### 3.2 The Founding Five offer in the printed pamphlet does not exist in code
`owner-pamphlet-trifold.html` promises "One trial month, on us." `api/checkout.js`
has no `subscription_data[trial_period_days]`, no coupon, no promotion code, no
`allow_promotion_codes`. Verified by grep: the strings `trial`, `coupon_`,
`promotion` appear nowhere in either `api/`.

You are therefore honouring the pamphlet by hand: comp them with the admin `paid`
toggle and remember, personally, to charge them in 30 days. That is revenue leakage
with a human memory as its only control. One Stripe line fixes it.

### 3.3 The scarce asset is given away, not sold
`guide.html` has exactly **3 Spotlight slots**, backfilled with top-rated venues.
Three slots on the one curated page is genuine scarcity — the only genuinely scarce
inventory you own — and it is currently allocated by an admin clicking "Featured"
(`api/admin.js:82`), bundled into the same $59 as everything else.

### 3.4 No failed-payment handling
`api/stripe-webhook.js` handles `checkout.session.completed`,
`customer.subscription.deleted` and `.updated`. There is no
`invoice.payment_failed` path, so a venue whose card expires silently keeps every
paid feature until Stripe eventually cancels the subscription.

### 3.5 Revenue in the codebase today: one demo listing
`seedProfile` sets `claimed = paid = featured = (id === 1)` — The Starving Rooster,
as a demo. Every other venue on both sites is unclaimed and unpaid.

### 3.6 The most expensive feature is free
`minot-agent` requires a dedicated VPS (see §5.1) plus LLM tokens per run. Its gate
is `profile.agentEnabled`, an admin toggle explicitly decoupled from Stripe
(`api/agent.js:11-13`, `api/_lib.js:143` "Not a Stripe-gated tier yet"). Every agent
run is currently a cost with no matching line of revenue.

---

## 4. Severity 2 — content quality, which is the demand-side problem

Measured directly from the seed tables.

| | EatMinot | DrinkMinot |
|---|---|---|
| Seeded rows | 52 | 66 |
| Hidden via `REMOVED` | 5 | **37** |
| **Live on the public site** | **47** | **29** |
| Live venues with a placeholder/vague address | 3 | **23 of 29** |
| Live venues whose hours say "Verify hours" | 15 | **21 of 29** |

### 4.1 DrinkMinot is publishing a directory that mostly cannot answer the question
23 of its 29 live venues list their address as literally `Minot, ND`, and 21 of 29
say `Verify hours`. A drinks directory that can't tell you where a bar is or whether
it's open is not a product a local will return to — and consumer return visits are
the only thing that makes the tags worth $59 to an owner. This is the single
highest-ROI fix in the audit and it needs no code, just an afternoon with Google Maps.

### 4.2 …and on DrinkMinot there is no admin tool to fix it
Verified divergence between the twins:

| admin action | EatMinot | DrinkMinot |
|---|:--:|:--:|
| `setInfo` (edit one venue's address/hours) | ✅ | ❌ |
| `refreshInfo` (push seed data onto saved profiles) | ✅ | ❌ |

`drinkminot/api/admin.js` (91 lines) is missing both actions that
`EatMinot.com/api/admin.js` (113 lines) has. In shared mode the saved Redis profile
wins over the seed table, so on DrinkMinot the placeholder addresses **cannot be
corrected by a code deploy alone and cannot be corrected from admin at all.** Porting
those two actions is the prerequisite for fixing §4.1.

### 4.3 The `REMOVED` mechanism trades trust for thinness
Hiding photo-less venues keeps the carousel looking good, and the frozen-id
discipline behind it (`api/_lib.js:132-137`) is correct and well documented. But on
DrinkMinot it is suppressing 56% of the inventory, which makes the directory look
like a town with 29 places to drink. Photos are the gate; sourcing photos is the
unblock.

---

## 5. Severity 3 — operational

### 5.1 The agent cannot run on serverless, by design
`minot_agent/sandbox_check.py` + README: nooa's sandbox needs real `landlock_*`
syscalls. Vercel, Cloud Run (gVisor), Fly Machines (Firecracker) and Docker's default
seccomp profile can all block them. `SandboxConfig(require=True)` then fails closed
— correct behaviour, and the right call. Practically it means a plain KVM VPS
(Hetzner/DO) is a hard requirement, i.e. a real monthly bill, per §3.6.
`GET /health` → `sandbox_ready` is the go/no-go and it is honest about this.

### 5.2 Test coverage: good in the agent, zero on the money path
`hipaasynth-svg-minot-agent`: **24 tests pass in 0.09s** (run verified). They cover
config, data intake, experiments, operator store, venue, weather.

`EatMinot.com` and `drinkminot`: **no test files at all.** Nothing covers rating,
owner auth, Stripe checkout, webhook signature verification, or wallet signing —
i.e. the auth and revenue code is the untested code.

### 5.3 Apple Wallet signing shells out to system `openssl`
`api/_wallet.js` invokes the platform `openssl` binary on Vercel's Node runtime. It
works, but it is an undocumented dependency on the runtime image; a Vercel base-image
change breaks Apple passes with no test to catch it (§5.2).

### 5.4 The twins are ~95% duplicated and have already diverged
`_lib.js`, `_wallet.js`, `store.js`, and most of `api/` are near-identical between
the two sites with the prefix and a few flags changed. §4.2 is the divergence
already biting. Every fix in §1 and §2 now has to be written twice and kept in step
— including the security fixes, where a half-applied fix is the dangerous kind.
A shared package is the eventual answer; until then treat "did I do both?" as part of
the definition of done.

### 5.5 One Redis store holds the only irreplaceable asset
Verified ratings are the moat, and nothing in either repo describes a backup or
export of the Upstash store. Losing it loses every rating with no recovery path.
**VERIFY LIVE:** check whether the Upstash plan has backups enabled; if not, a weekly
`GET`-everything export is a few lines against the existing pipeline helper.

### 5.6 Smaller things
- `EatMinot.com/vercel.json` lacks `cleanUrls: true`, which DrinkMinot has —
  cosmetically different URLs between the twins.
- `api/upgrade-confirm.js` is unauthenticated. It accepts any `sessionId` and trusts
  Stripe's response for the venue id, so the practical risk is low (an attacker must
  pay), but it should still require the owner session.
- `api/_lib.js:104` — an unset `EAT_SESSION_SECRET` signs with a per-cold-start
  random secret rather than a fixed public fallback. That is the right decision and
  the comment explaining why is correct; it only logs owners out on redeploy.

---

## 6. What is genuinely good (do not "fix" these)

Worth writing down so none of it gets refactored away while addressing the above.

- **Per-venue keys, not one blob**, with votes in their own hash mutated only by
  `HINCRBY` (`api/_lib.js:250-263`). Race-free under concurrent ratings.
- **Frozen venue ids** that are never renumbered because they are printed on
  physical tags (`api/_lib.js:132-137`). Exactly the right instinct, well documented.
- **No admin action can write a vote counter.** Stated and true — grep confirms no
  vote write outside `POST /api/rate`. The integrity problem is that *anyone* can hit
  that endpoint, not that you cheat.
- **`normalizeProfile`** forward-compatibility so old records can't crash new reads
  (`api/_lib.js:211-229`), with `rewardsOn` defaulting from `claimed` for a good
  reason that is written down.
- **The 3-rating threshold** before a star average shows (`store.js:18,157`) — stops
  one rating masquerading as a settled score.
- **`publicView` deletes password hashes** on the way out (`api/_lib.js:318`).
- **Salted SHA-256 at rest + HMAC sessions**, and the random-per-boot fallback
  secret reasoning in §5.6.
- **The agent's sandbox stance.** Landlock + seccomp, fails closed, model-agnostic
  down to a fully local LLM, one instance per venue, only two auditable network calls
  leaving the box. This is a real, defensible privacy story and it is the technical
  asset that connects this work to the HipAAsynth mission.
- **The agent refuses incentivized review-seeking** in its own prompts
  (`experiments.py:60-66`). Keep that, and bring the core product up to it (§2.1).

---

## 7. Fix order

Ranked by (damage if ignored) × (cheapness), not by interest.

**Week 1 — stop the bleeding. Nothing else matters until these ship.**
1. **Signed tag tokens.** Put an HMAC in the tag URL (`/?r=<id>&t=<sig>`), verify it
   server-side in `api/rate.js`. Tag URLs are regenerated in admin; the tags
   themselves are reprinted only if you rotate the secret. (§1.1, §1.3)
2. **Server-side rate limiting on `POST /api/rate`**, keyed on the device token +
   venue in Redis with a 24h TTL, plus a coarse IP ceiling. The client check stays as
   UX, not as the control. (§1.2)
3. **Kill the default-password scheme.** Make `login` require `claimed === true`;
   generate a random one-time claim code per venue instead of `name+26`; hand it over
   in person with the tags. Remove the formula from both public READMEs. (§1.4)
4. **Bind `claim` to a secret.** The `?owner=<id>` QR must carry a signed,
   single-use token, not just an id. (§1.5)
5. **VERIFY LIVE** the four env vars in §1.6 and rotate the admin password now.
6. **Add a size cap** to every `dataUrl` write, and authenticate `/api/device`. (§1.7)
7. **Move `punch()` from `rate()` to `recordTap()`.** Legal exposure gone, product
   improved, ratings stop being bought. (§2.1)

**Week 2 — make it sellable.**
8. **Aggregate per-venue daily counters** (taps, unique devices, cards filled,
   coupons issued/redeemed, Most Wanted impressions) and an owner-dashboard "what
   this did for you last month" panel. This is the renewal conversation. (§3.1)
9. **Real Stripe trial** — `trial_period_days` + a Founding-Five promotion code, so
   the pamphlet's offer is machine-enforced. (§3.2)
10. **`invoice.payment_failed`** → dunning. (§3.4)
11. Require the owner session on `upgrade-confirm`. (§5.6)

**Week 3 — make it worth returning to.**
12. **Port `setInfo` + `refreshInfo` to DrinkMinot**, then fill in the 23 addresses
    and 21 sets of hours. (§4.2, §4.1)
13. Fill EatMinot's 15 unverified hours. (§4)
14. Source photos for the 37 hidden DrinkMinot venues and unhide them. (§4.3)

**Then — and only then — pricing and growth.**
15. Age gate + a written ND Title 5 answer before DrinkMinot signs a bar. (§2.2, §2.3)
16. Tier the agent behind a paid plan. (§3.6)
17. Sell the 3 Spotlight slots as scarce inventory. (§3.3)
18. Tests on the auth and money paths; backup/export the Redis store. (§5.2, §5.5)
19. Extract the shared library so a security fix is written once. (§5.4)
