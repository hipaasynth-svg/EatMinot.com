# EatMinot.com

Local restaurant ratings for Minot, ND — by locals, for locals.

**Tap. Rate. Earn. Zero tracking. Period.**

Verified word-of-mouth made measurable and fair. Ratings are only possible after
a physical presence check (NFC tap or QR scan of a unique in-store tag), one per
device per restaurant every 24 hours. Devices are identified by an anonymous hash
used only for rate-limiting, punch-card tallies, and fraud detection — no accounts,
no email/text collection, no personal tracking.

## Prototype

`Minot Eats.dc.html` is a mobile-first, single-file interactive prototype
(built in the DC component framework) covering:

- **Swipeable Rolodex** of seeded Minot restaurants with a photo/logo hero and
  large semi-opaque stats (weekly / monthly / yearly upvotes, plus a running
  count of total verified ratings).
- **Two-tap rating overlay** — thumbs up, then a star (left = lower, right =
  higher). The restaurant name shows during rating and disappears after the
  second touch, followed by a brief "PUNCHED" starburst.
- **Punch card** — 10 marks = a restaurant-controlled reward, then it resets and
  issues a short redemption code with an expiry.
- **Owner Dashboard** (Claimed tier, $59/mo) — edit picks, happy hour, punch-card
  reward, note, website, hero photo; view private stats; manage tags/newsletter.
