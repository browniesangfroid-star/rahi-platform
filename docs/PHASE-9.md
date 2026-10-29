# PHASE 9 — Live tracking (done, tested)

## Objective
Once a ride is matched, the customer can see where their driver is
and how long until pickup (or destination), over a real socket —
not a polling fake — with road routing when it is available.

## What was built
- Routing provider (`apps/api/src/tracking/`): `routing.provider.ts`
  interface, `haversine-routing.provider.ts` (default, offline,
  deterministic) and `osrm-routing.provider.ts` (MAPS_PROVIDER=osrm,
  OSRM_BASE_URL). OSRM failures fall back to haversine and report
  `osrm-fallback-haversine` as the provider, so a straight-line
  estimate is never mistaken for a road route. The public OSRM demo
  server is DEV ONLY; production must run its own OSRM instance
  (Phase 17 deployment notes).
- Estimates now use the routing provider: on the haversine default
  the numbers are unchanged from Phase 6 (same distance, service
  speed for duration); with OSRM, distance and duration come from
  the road route.
- `tracking.service.ts`: only the assigned driver writes a ride's
  location, and only while the ride is in a live status
  (DRIVER_SELECTED through IN_PROGRESS). Each position is persisted
  to ride_locations (migration 002 table, no new migration needed)
  and refreshes the driver's location-index entry. ETA target
  follows the trip: pickup until IN_PROGRESS, destination after.
- Socket.IO gateway (`tracking.gateway.ts`): JWT from handshake
  auth (same token as REST; unauthenticated sockets are disconnected
  on connect), per-ride rooms (`ride:{id}`) with participant-checked
  joins, `driverLocation` → `locationUpdate` broadcast to the room,
  and an `emitToRide` helper that Phase 10 uses for status pushes.
- REST endpoints for polling clients and tests:
  `POST /rides/:rideId/location` (driver),
  `GET /rides/:rideId/location` (participant or admin),
  `GET /rides/:rideId/route` (pickup, destination, driver position,
  ETA, route points, provider).
- App clients (transport only, UI in Phase 10): customer
  `tracking_service.dart` and driver `tracking_service.dart`
  (socket_io_client added to both pubspecs). The driver client takes
  coordinates from its caller — GPS acquisition lands in Phase 10,
  and no position is invented here.

## Verification (2026-10-28)
- [x] API tests pass 11/11, including the three new tracking tests:
      REST flow (driver-only writes, customer/admin reads, stranger
      403, invalid coordinates rejected and not stored, route
      payload), Socket.IO flow (authenticated join, driver location
      broadcast received by the customer's socket, unauthenticated
      socket disconnected), and OSRM failure → haversine fallback
      with the fallback provider named.
- [ ] Postgres ride_locations live-test — NOT run (same VM limit as
      Phases 3–8).
- [ ] Real OSRM route — NOT run (no OSRM server in this VM; the
      provider is tested only via its fallback path).

## Known limits
1. Socket CORS is open for development; Phase 16 tightens it to the
   app origins.
2. No GPS streaming yet: the driver app sends positions only when
   its caller supplies them. Geolocator + platform permissions land
   in Phase 10.
3. ETA is a single route calculation per report, not a continuously
   re-estimated arrival with traffic.

## Next: Phase 10 — Trip lifecycle (driver en route, arrived, PIN
verification, start, in-progress tracking, complete, cancellation
rules, no-show handling).
