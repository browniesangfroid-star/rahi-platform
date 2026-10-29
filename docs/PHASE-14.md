# PHASE 14 — Support and safety (done, tested)

## Objective
Close the loop after a ride: let riders rate each other, report
problems that actually reach a human, raise SOS during a live
trip, share a live trip safely, and give support the tools to
review repeat cancellers and recover a lost PIN.

## What was built
- Migration 010: ratings, support tickets + messages, safety
  incidents, share links (token hashes only), and the
  `support.manage` permission with a SUPPORT_AGENT grant.
- Ratings: only after COMPLETED, within 7 days, once per
  direction (customer→driver and driver→customer are separate).
  A rating carrying a report automatically opens a REPORT ticket
  with the report text as its first message — a report is never
  just a comment. Driver ratings update the dispatch aggregates
  (ratingSum / ratingCount), so ratings change future matching.
- Support tickets: participant-created (ride-linked or general),
  participant-visible only to their reporter, support-visible to
  all; replies from reporter or support; support-only status flow
  OPEN → IN_PROGRESS → RESOLVED → CLOSED (closed tickets refuse
  replies). Status changes are audit-logged.
- SOS: participant-only during a live trip, HIGH priority, with a
  snapshot of ride status, driver, vehicle and last known
  location. A second SOS on the same ride returns the existing
  open incident instead of duplicating it. Resolving requires a
  note. Honest limit, stated in code and here: SOS does NOT
  contact police — there is no such integration, and the incident
  routes to ops through the incidents queue.
- Share-trip links: participant-created for live trips only,
  5 minutes to 24 hours, revocable. Tokens are random 256-bit
  values stored only as SHA-256 hashes. The public view returns
  ride status + live location only — no names, no phone numbers,
  no addresses, no history. Ended, expired or revoked links
  return 410.
- Admin PIN reset (`support.manage`): issues a fresh PIN for a
  ride whose PIN is unverified and live; the old PIN stops
  working, attempts reset, the plaintext is returned once to the
  admin (who relays it out of band), and the reset is audit-logged.
- Cancellation / no-show review queue: cancelled rides from the
  last 7 days with actor, role, reason and timestamp, plus each
  actor's 7-day cancel count and a flag at 3+ cancels (the
  BUSINESS-RULES.md threshold). No-show rides appear with reason
  NO_SHOW, distinguished from ordinary cancels.
- User suspension (`users.suspend`): support can suspend with a
  required reason and unsuspend; both actions are audit-logged.
  This is the action the review queue feeds — the queue itself
  suspends nobody automatically.
- App clients: customer SupportService (rate, ticket, SOS, share)
  and driver SOS. Admin web gains a /support page (incidents,
  tickets, review queue) with resolve and mark-resolved actions.

## Verification (2026-10-28)
- [x] API tests pass 26/26, including three new support suites:
      rating rules (non-completed refused, duplicate direction
      refused, opposite direction allowed, 7-day window enforced
      on a backdated completion, aggregates updated, report
      auto-ticket + support resolve), SOS snapshot + dedupe +
      resolve + share-link privacy (no phone/name in the public
      body) + revoke → 410 + PIN reset (old PIN 401, fresh PIN
      verifies), and review queue flagging (3 cancels → flagged,
      count 3) + plain-user 403 + suspend/unsuspend round-trip.
- [x] Admin web production build passes (routes now include
      /support).
- [ ] Postgres support store live-test — NOT run (same VM limit
      as Phases 3–13).

## Known limits
1. No push notification to on-call ops for SOS yet — incidents
   are visible in the queue and the admin web, but nobody is
   paged. A push provider (Phase 17 notifications) is the missing
   piece, and the docs do not claim otherwise.
2. No automatic penalties: the review queue flags repeat
   cancellers but never suspends on its own — a human decides.
3. Share links show the live trip only; there is no breadcrumb
   history view for the recipient.

## Next: Phase 15 — Analytics (dispatch metrics, city-max
fairness aggregates, driver and city leaderboards from the ledger
and ride history, and the reports behind the admin overview).
