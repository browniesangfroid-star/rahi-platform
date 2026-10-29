-- 007_offer_counters_request_minimum.sql — Phase 8.
-- Counter-offers update a LIVE offer in place (the one-live-offer
-- unique index from migration 002 stays the guard), so the offer
-- needs a counter count. The request stores its minimum fare at
-- creation time, so offer validation never depends on a pricing rule
-- that may have changed since the request was made.

ALTER TABLE ride_requests ADD COLUMN IF NOT EXISTS minimum_fare_minor INT;
ALTER TABLE ride_offers ADD COLUMN IF NOT EXISTS counter_count INT NOT NULL DEFAULT 0;
