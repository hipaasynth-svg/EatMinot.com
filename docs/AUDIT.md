# Full audit — EatMinot / DrinkMinot / minot-agent

**Date:** 2026-09-22
**Method:** read the source, not the READMEs. Every claim below cites a file and line
and was verified by reading that code or running it. Where something can only be
confirmed against the live Vercel/Upstash config, it is marked **VERIFY LIVE** with
the exact check to run.

Commits audited:
- `EatMinot.com` @ `affae60` (= `origin/main`)
- `drinkminot` @ `ac2214d`
- `hipaasynth-svg-minot-agent` @ `840176c`

---

## Corrections to the first draft of this audit

The first pass read `main` only and did not check the open pull requests. Two findings
were wrong as a result, and they are corrected in place below:

- **§3.2 was wrong.** It said the trial had no implementation. It does —
  [PR #30](https://github.com/hipaasynth-svg/EatMinot.com/pull/30), open since 17 Sep,
  implements **Founding Three: a 70-day trial then $79/mo locked for a year**, capped at 3
  venues and re-checked at checkout so a slot can't be double-booked. Not merged, so not
  live, but written. (Both of those numbers turned out to be wrong once it merged — the
  rates were inverted and the lock was unenforceable. See the dated update below.)
- **§3.1 was overstated.** `@vercel/analytics` *is* a declared dependency in both
  `package.json` files (commit `332d3d8`, "Install Vercel Web Analytics"). It is never
  imported — no `inject()` call, no script tag — so nothing in the app collects anything.

### Update — 2026-09-23: the price table was inverted, and is now reconciled

PR #30 merged (EatMinot `b1f9b0a`), so §3.2's "not merged, so not live" no longer holds.
Merging it exposed a worse problem than the one §3.2 described, which this audit did not
catch because it read the offer's *mechanics* and not its *arithmetic*:

**The founding tier was priced above the standard tier.** `api/checkout.js` charged
$79/mo to founding venues and $59/mo to everyone else, so the "offer" sold to the three
most valuable prospects in town charged them **$20/month more** than a walk-up listing,
while `owner-pamphlet-trifold.html` advertised it as a discount. DrinkMinot's marketing
described the exact opposite arrangement ($59 founding struck from $79) and its code
could price neither, having no founding tier at all.

Resolved on `hipaasynth-svg/serene-bardeen-rxn6xx`:

| | Standard | Founding Three |
|---|---|---|
| Rate | **$79/mo** | **$59/mo** |
| Trial | none | **10 weeks free** |
| Slots | unlimited | **3 per site** |

Both amounts now live only in `STANDARD_PRICE_CENTS` / `FOUNDING_PRICE_CENTS`
(`api/_lib.js`) in each repo; the bare `'5900'` literal is gone from both checkouts.
`tests/founding.test.js` (now in both repos) asserts the table and fails if the founding
rate ever stops undercutting standard. DrinkMinot's founding tier was built to match, and
its `store.js` `adminSetFlag` was forwarding neither `agentEnabled` nor `foundingOffer` —
the same no-op defect §3.2 noted in EatMinot's, never ported across, which meant
DrinkMinot's AI Assistant toggle did nothing at all.

Every customer-facing "locked for a year" promise was **removed** rather than
implemented, because `foundingLockUntil` is written and never read: no code path
enforces it. A pricing commitment nothing can keep is a liability. The field guide's
pricing (§ below) and DrinkMinot's "Founding **Five** / Only 5 spots" one-pager — which
sold two slots past the cap `FOUNDING_LIMIT` enforces — were corrected in the same pass.
  Vercel Web Analytics may still be enabled at the project level, which would give
  platform-side pageviews. Either way it is pageviews, not the per-venue tap and
  redemption counts an owner needs, so the substance of the finding stands.

Two findings have since been **fixed** rather than corrected — §1.4, §1.5 and part of
§1.6 — and are marked inline. Everything else in this document still describes the
deployed system. In particular, §1.1–§1.3 (the rating endpoint) were re-checked against
**every one of the 12 refs in the repository**, including PR #30's branch: `api/rate.js`
is 27 lines with no authentication at any of them.

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
server-side record that a tag was ever scanned. An owner paying $79/month cannot be
shown a single number proving it worked, and you cannot see which venues are alive.
That is the classic local-SaaS churn killer. It is also why pricing above $59 was hard
to defend — and as of 2026-09-23 the standard rate *is* $79, so this finding is now the
binding constraint on the whole price table rather than a future concern: the number went
up while the evidence base for it did not.

Third: **the free tier is where all the cost is.** The `minot-agent` service needs
a dedicated VPS and LLM tokens, and it is gated by an admin toggle, not by Stripe.

Fixing #1 and #2 is roughly a week of work and everything else in the business
depends on both.

---

## 1. Severity 1 — attacks the exact claim you sell

### 1.1 `POST /api/rate` is unauthenticated, unthrottled, and accepts anything — **FIXED**
> **Fixed** on `hipaasynth-svg/focused-sagan-si6qgh` in both repos. `POST /api/rate` now
> requires a device token, verifies a tag signature (`?t=`, an HMAC of the venue id under
> `EAT_TAG_SECRET`), claims a Redis `SET NX EX` for one rating per device per venue per 24h,
> and applies a coarse per-IP ceiling. Covered by `tests/presence.test.js`.
>
> **Enforcement is off until you turn it on.** Tags already in venues carry no signature, so
> an unsigned rating is still accepted — and reported as unverified — until
> `EAT_REQUIRE_TAG_SIG=1`. Set `EAT_TAG_SECRET`, redeploy, reprogram the tags from the signed
> links in the admin console, then set the flag. The admin banner states which phase you are
> in. **Until that flag is on, this finding is mitigated, not closed.**
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

### 1.2 The "one rating per device per 24h" limit is client-side only — **FIXED**
> **Fixed.** The limit is a Redis claim keyed on the device token and venue, with a 24h TTL,
> taken before any counter moves. Clearing site data no longer resets it, and a refused
> attempt is asserted to move no counter.
`store.js:391` — `rate()` starts with `if (ratedRecently(id)) return {ok:false}`, and
`ratedRecently` (`store.js:171`) reads `localStorage` key `eatminot_device_v1`. Clearing
site data, opening a private window, or calling the API directly all reset it. The
server has no concept of a device on the rating path at all.

### 1.3 The "verified presence" gate is a URL parameter — **FIXED, pending the flag**
> **Fixed** by the signed tag in §1.1, subject to the same rollout caveat: signatures are
> issued now, refused-if-missing only once `EAT_REQUIRE_TAG_SIG=1`.
`index.html:566-568,724` — `tagVerified` is set from `?r=<id>` in the query string.
Typing `eatminot.com/?r=12` is indistinguishable from tapping venue 12's NFC tag.
Nothing is signed; there is no secret in the tag.

> **Net effect:** "Rating requires a physical NFC tap or QR scan — one per phone per
> day. No out-of-towners, no competitors, no bots" (`owner-pamphlet-trifold.html:219`)
> is not true of the deployed system. This is the sentence the monthly fee is sold on.

### 1.4 Any member of the public can log in as any venue owner — **FIXED**
> **Fixed** on `hipaasynth-svg/focused-sagan-si6qgh` in both repos. `seedProfile` no longer
> seeds a password at all (`password: null`), `login` refuses any listing that is not
> `claimed` and any listing with no password set, `normalizeProfile` drops a stored hash on
> an unclaimed record so profiles already in Redis with the old derivable hash are
> neutralised without a migration, and the formula is gone from both public READMEs and
> from DrinkMinot's login screen, which had been printing it as a hint. Covered by
> `tests/auth.test.js` (18 assertions per site), which asserts the exact old password is
> refused. The description below is what was there.
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

### 1.5 Anyone can claim any unclaimed listing — **FIXED**
> **Fixed** on the same branch. `claim` now requires that venue's **setup code** — a random
> 8-character secret generated once per venue, stored on the profile, stripped from
> `publicView` so `/api/state` cannot leak it, and shown only in the
> admin-authenticated console. The owner's packet QR carries it as
> `/?owner=<id>&c=<code>`. Admin gained `newClaimCode` for a card that goes astray, and
> `resetPassword` now returns a random password once instead of a derivable default. The
> description below is what was there.
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

### 1.7 No rate limiting on any endpoint, and no upload size cap — **PARTLY FIXED**
> **Fixed for the rating and redemption paths:** a reusable `rateLimit()` / `claimOnce()`
> pair on Redis primitives now backs the per-device daily claim, the per-IP rating ceiling,
> and the three PIN-failure lockouts (per coupon, per venue, per IP). `/api/device` can no
> longer be written to at all — its `put` action answers 410.
>
> **Still open:** no size cap on photo `dataUrl` writes in `api/owner.js` / `api/admin.js`,
> and no throttle on owner login or admin password attempts. The helper to fix both now
> exists.
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

> **STILL OPEN — and deliberately so.** The verified-presence work moved the punch
> server-side but kept it contingent on a rating: `api/rate.js` advances the card, so a
> reward is still earned by leaving feedback. That is the same FTC exposure, now enforced
> more reliably.
>
> It was left because it is a product decision, not a bug fix. A signed tag hit could now
> grant the punch on its own — the plumbing exists — but decoupling it means some people
> will take the punch and skip the rating, and the rating volume is what makes the
> directory worth anything. That trade is the owner's call, not one to make silently in a
> security change.
>
> If the answer is "decouple it", the change is now genuinely small: grant the punch on a
> verified tag hit in its own endpoint, and leave `api/rate.js` to move only the vote
> counters.

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

### 3.1 You cannot prove ROI, because nothing useful is counted — **PARTLY FIXED**
> **First real number shipped:** per-venue **coupons issued vs redeemed** (plus outstanding
> and expired), in the admin console, derived by scanning the coupon records so it cannot
> drift from them. That is the loyalty card's actual outcome, and it exists now because
> redemption is a server event for the first time.
>
> **Still open:** taps, unique devices and Most Wanted impressions are still uncounted, and
> none of this is surfaced in the *owner's* dashboard yet — only in admin. The monthly
> owner-facing report is still the work that makes renewal conversations possible.
`@vercel/analytics` is a declared dependency in both `package.json` files (commit
`332d3d8`) but is **never imported** — no `inject()`, no script tag. Vercel Web Analytics
may still be switched on at the project level, which would give platform-side pageviews
without any code. **VERIFY LIVE:** check each Vercel project's Analytics tab.

Either way, what does not exist anywhere is anything venue-level: no tap counter, no scan
counter, no impression counter, no redemption counter. `recordTap()` writes to
`localStorage` only and is never sent to the server. The device backup (`api/device.js`)
stores punch state but is never aggregated. A site-wide pageview graph tells an owner
nothing about their own listing.

So the entire owner-visible evidence base for the monthly fee is a single number —
verified rating count — which is also the number they can't see move because of §1.

**What's missing is one Redis hash per venue per day.** Taps, unique devices, punch
cards filled, coupons issued, coupons redeemed, Most Wanted impressions. All
aggregate counters, no identity, fully compatible with "zero tracking" — you would
still be collecting strictly less than Google Analytics collects about a bounce.
Without it there is no monthly owner report, no renewal conversation, no upsell, and
no way for you to see which venues are dead.

### 3.2 The trial is written but unmerged — **CORRECTED**
The first draft of this audit said the pamphlet's trial offer had no implementation. That
was wrong, and it was wrong because this audit read `main` and not the open PRs.

[PR #30](https://github.com/hipaasynth-svg/EatMinot.com/pull/30) (branch
`hipaasynth-svg/blissful-goodall-vrxplq`, open since 17 Sep) implements **Founding Three**:
an admin-granted `foundingOffer` flag capped at 3 venues, a 70-day Stripe trial at $79/mo
for those venues, `founding` flipped permanently on completed checkout to lock that rate,
and `foundingLockUntil` recording the one-year mark. The cap is enforced in both
`api/admin.js` `setFlag` and again in `api/checkout.js` at checkout time, so a slot cannot
be double-booked by two venues checking out at once. Its PR body reports 19/19 assertions
passing in a scripted run with Stripe stubbed.

That PR also fixes something this audit missed: `store.js`'s `adminSetFlag` was not
forwarding `agentEnabled`, so the AI Assistant admin toggle was a no-op.

**What remained true when this was written:** it was not merged, so checkout was still a
flat $59/mo with no trial, and any founding venue was being comped by hand with the admin
`paid` toggle. The real finding was not "unbuilt" — it was **built and sitting unmerged for
five days while the offer was being sold**, which is a worse failure mode because the sales
proposal and the running code disagree and nobody would notice until a card was charged.

**Superseded 2026-09-23.** PR #30 has merged, and the concern above turned out to be
understated: once live, the two prices were the wrong way round (founding cost *more* than
standard). See the dated update at the top of this document.

Pricing as of this audit, for the record, since the field guide had it wrong too: standard
tier **$59/mo**; Founding Three **10 weeks free, then $79/mo locked for a year**, 3 slots
total. **This table was itself wrong** — it has the discount backwards, and the year-long
lock was never enforceable. Corrected 2026-09-23 to **$79/mo standard, $59/mo founding
after 10 weeks free, 3 slots per site, no locked term**; see the dated update at the top.

> **Sequencing note.** PR #30 and the security fix on
> `hipaasynth-svg/focused-sagan-si6qgh` both edit `seedProfile`, `normalizeProfile` and the
> `module.exports` block of `api/_lib.js`. PR #30 still carries
> `password: hashPw(defaultPassword(name))`. **Do not resolve that conflict by taking PR
> #30's side of those hunks** — that reinstates §1.4. Whichever merges second should keep
> `password: null` and the claim-code fields, and `tests/auth.test.js` will fail loudly if
> it doesn't.

### 3.3 The scarce asset is given away, not sold
`guide.html` has exactly **3 Spotlight slots**, backfilled with top-rated venues.
Three slots on the one curated page is genuine scarcity — the only genuinely scarce
inventory you own — and it is currently allocated by an admin clicking "Featured"
(`api/admin.js:82`), bundled into the same flat monthly fee as everything else.

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

> **Read this before the table.** These counts are measured from the **`RAW` seed tables in
> the repository**, not from the live database, and the two are not the same thing. In
> shared mode a venue's saved Redis profile wins over the seed, and `api/admin.js`
> `setInfo` writes hours and addresses straight to that profile without touching the seed.
> So **hours corrected through the admin console are live on the site and invisible here.**
> EatMinot has had that editor since commit `023158f`, so its real figures are very likely
> better than this table — possibly complete. The numbers below are the floor, i.e. what a
> fresh deploy with an empty database would show.
>
> This session's network policy blocks outbound requests to `eatminot.com` and
> `drinkminot.com` (the proxy returns 403 on CONNECT), so this could not be settled from
> here. **VERIFY LIVE:** `curl -s https://eatminot.com/api/state | grep -c 'Verify hours'`
> is the real answer for each site.
>
> One asymmetry that is *not* uncertain: **DrinkMinot has no `setInfo` action at all**
> (§4.2). There is no path by which its hours could have been corrected through the admin
> console, and the owner dashboard does not edit hours either. So DrinkMinot's 21 and 23
> below are real unless its stored profiles were written from a different seed.

And §4.4 below is the more serious version of this finding: the button that looks like it
refreshes this data used to destroy it.

Measured from the seed tables:

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
the only thing that makes the tags worth a monthly fee to an owner. This is the single
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

### 4.4 "Refresh hours from directory" destroyed the hours it claimed to refresh — **FIXED**
This is the real content finding, and it only surfaced because the seed-table counts above
were challenged as already fixed.

`api/admin.js` `refreshInfo` pushed `seedProfile()`'s address and hours onto **every** saved
profile unconditionally. For every venue whose seed row still says `Verify hours` — 15 of 47
on EatMinot — that overwrote the real, hand-entered hours in the database with the
placeholder. One click, no confirmation, and the button is labelled *Refresh hours from
directory*, which reads like the opposite of what it did. Reproduced:

```
seed hours for id 7:      "Verify hours"
after your admin edit:    "Mon-Sat 11am-9pm, Sun Closed"
after refreshInfo:        "Verify hours"      <-- gone
```

The damage is silent and unrecoverable: the hours existed only in Redis, there is no
backup (§5.5), and nothing logs what the old value was. If this button was ever pressed
after hours were entered, that is where they went — and it would look exactly like the
work had never been done.

> **Fixed** on `hipaasynth-svg/focused-sagan-si6qgh`. `refreshInfo` now skips any field
> whose seed value is a placeholder (`L.isPlaceholderHours` / `L.isPlaceholderAddress`), so
> a stand-in can never overwrite something a human typed, while a genuinely corrected seed
> value still propagates as intended. It also reports `updated` and `skipped` counts.
> Covered by `tests/directory.test.js` (15 assertions), which asserts both halves: real
> hours survive, and a stale stored value is still replaced when the seed has real hours.

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
