# PHASE 4 — Customer application (code complete, not compiled here)

## Objective
Flutter customer app with the full booking funnel against the Phase 3
API contract: Home / Activity / Wallet / Notifications / Profile,
OSM map, service selector, pickup/destination, estimate, customer
offer, request — with loading, error and retry states throughout.

## What was built (`apps/customer-mobile/lib/`, 17 Dart files)
- `theme/app_theme.dart` — original Rahi tokens from design-tokens
- `models/models.dart` — ServiceType, GeoPoint, Place, Estimate, UserProfile
- `services/api_client.dart` — typed client, tokens in secure storage,
  base URL via `--dart-define=API_BASE_URL` (Android emulator default
  `10.0.2.2:3001/api/v1`), never calculates fares
- `services/auth_service.dart` — OTP request/verify, getMe, profile update,
  logout against Phase 3 endpoints (real, already tested server-side)
- `services/ride_service.dart` — `/rides/estimate` and `/rides/request`
  from API-SPEC.md (server side lands in Phase 6)
- `maps/maps_provider.dart` — `MapsProvider` interface + OSM implementation
  (haversine + speed-based ETA for map preview only)
- `state/auth_state.dart`, `state/booking_state.dart` — ChangeNotifier
  state with explicit statuses (idle / estimating / ready / requesting /
  requested / error)
- `screens/`: `auth_screen.dart` (OTP), `home_screen.dart` (map tap sets
  pickup then destination, GPS current-location button with fallback,
  service chips, estimate card, offer field, REQUEST RIDE),
  `activity_screen.dart`, `wallet_screen.dart`,
  `notifications_screen.dart`, `profile_screen.dart` (real PATCH /users/me)
- `test/fare_test.dart` — minor-unit formatting tests

## Honest limits — read before running
1. **Flutter is NOT installed in this VM, so `flutter analyze`,
   `flutter test` and `flutter run` were NOT run here.** Static checks
   passed: 17 Dart files present, all relative imports resolve, brace/
   paren balance clean, no mock/fake trip data in code. The first run
   on a dev machine must be `flutter pub get && flutter analyze &&
   flutter test` and any analyser errors fixed before Phase 5.
2. **Platform folders are not committed.** Run `flutter create .`
   inside `apps/customer-mobile` on a dev machine (or copy `lib/` into
   a fresh Flutter project), then add INTERNET + location permissions
   to AndroidManifest. `lib/` is the deliverable; generated platform
   code is not hand-written here.
3. **Ride estimate/request are not live yet.** Until Phase 6, the
   server returns 404 for those endpoints. The app shows a map
   distance/ETA preview, shows NO fare, disables REQUEST RIDE on a
   preview, and shows a recovery error with retry. It never invents a
   fare, a driver or a trip. Activity/Wallet/Notifications are empty
   states for the same reason — no sample trips, no zero-balance claim.
4. **Geocoding is not built yet.** Pickup/destination coordinates come
   from map taps or GPS; labels are user-typed. Place search /
   reverse-geocoding is a Phase 6+ addition behind `MapsProvider`.

## Run (dev machine with Flutter)
```bash
cd apps/customer-mobile
flutter pub get
flutter analyze
flutter test
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1
```

## Next: Phase 5 — Driver onboarding/KYC (driver app + KYC endpoints).
