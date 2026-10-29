# BUSINESS-RULES.md

## Pricing

Suggested fare (server-calculated, integer minor units):

```
fare = max(minimum_fare,
           base_fare + distance_km * per_km + duration_min * per_min)
fare = fare * demand_multiplier (bounded by city cap, default 2.0x)
fare = fare + booking_fee
fare = fare - promo_discount (promo rules applied server-side, capped)
```

- Pricing rules are versioned: a ride stores `pricing_rule_version_id`,
  so a historical ride can always be reconstructed even after rules change.
- Modes per city/service: NEGOTIATION (customer offer + driver counter),
  FIXED (platform fare, no negotiation), DYNAMIC (demand multiplier active),
  HYBRID (platform fare shown, negotiation allowed within a band, e.g. ±20%).
- Customer offers below the pricing floor are rejected with the floor
  shown, not silently accepted.
- Client-calculated fares are never trusted. The estimate endpoint is
  informational; the request endpoint re-calculates.

## Commission precedence (highest wins)

Driver-specific override → Service + City rule → City rule → Global rule.
The applied rule + version + rate are stored on the completed ride.
Commission is calculated on the final fare (after promo, before/after
booking fee per city config — the config must state which, and v1 default
is: commission on fare excluding booking fee). Driver earnings =
final fare − commission − applicable deductions (e.g. cancellation fee
owed). Payouts are a separate approval step, not an automatic transfer.

## Cancellation

- Before match: free, no fee.
- After match, before arrival: configurable fee (default 0 in pilot cities,
  to grow supply; fee config exists, default-off).
- After arrival / after PIN: fee may apply; repeated late cancellations
  (3+ in 7 days, configurable) flag the account for support review.
- Admin cancellation always requires a reason and an audit row.
- Cancellation by either party releases the other party's live offers and
  frees the driver in Redis in the same transaction.

## Ratings

- Only after COMPLETED, within 7 days (configurable), once per direction.
- Aggregates: `rating = SUM(stars) / COUNT(ratings)` recomputed from the
  ratings table on each new rating (or via a queued aggregate job for
  scale — same result, documented choice). Ratings for rides that did not
  occur are impossible by the unique (ride_id, rater_role) + COMPLETED check.
- A rating with a report creates a support ticket automatically.

## Promotions

Fixed or percentage discount, max discount cap, minimum fare, start/end,
total usage limit, per-user limit, city/service restriction, new-user-only
flag. Redemption is a transaction: check limits → insert redemption →
apply discount. Concurrent redemption abuse is prevented by the unique
partial index + row lock on the promo row, not by application-level checks.

## KYC

States: DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED | REJECTED |
REQUEST_CHANGES. APPROVED → SUSPENDED → APPROVED (after review) or
EXPIRED (document expiry). Rejection/suspension require a reason.
Expired documents move the driver to EXPIRED and remove them from
matching until renewed and re-approved.

## Safety

SOS creates a `safety_incident` with priority HIGH, notifies on-call ops
via push + queue, and snapshots ride, driver, vehicle and last known
location. The system does **not** claim to contact police automatically
unless a real integration is later built and documented. Share-trip links
are time-limited, signed, and show only the live trip (no history, no
personal contact details beyond what the sharer chose).

## Retention (defaults, configurable in system_settings)

GPS trip history: 90 days, then aggregated (route summary kept, raw
points deleted). Identity documents: kept while account active + 1 year
after closure, unless law requires otherwise. Support logs: 2 years.
Device info: 1 year. Deleted accounts: anonymised (name/phone replaced
with irreversible placeholders) after a 30-day grace period; financial
and safety records keep anonymised references, never deleted.
