# Rahi Flutter apps — build & test guide

Two apps, one API. Both default to the **live Render API**
(`https://rahi-platform.onrender.com/api/v1`) — no flags needed for
pilot builds. The pilot city is **Islamabad**.

| App | Package | What it covers |
| --- | --- | --- |
| `apps/customer-mobile` | `rahi_customer` | OTP login, map booking (car/bike/delivery), fare estimate, customer offer, driver offers + accept, live trip (map, pickup PIN, delivery OTP, cancel, SOS, share, rating), wallet + top-ups, activity + timeline, support tickets |
| `apps/driver-mobile` | `rahi_driver` | OTP login, onboarding (emergency contact, CNIC/licence/registration uploads, vehicle, submit), KYC-gated online switch with GPS, incoming requests + offer/counter/decline, live trip (en-route, arrived, PIN, complete, cancel, no-show, delivery OTP + photo, SOS, rating), wallet + withdrawals |

## 1. Prerequirements

- Flutter SDK 3.24+ (stable). No Android SDK is needed for analysis
  and tests, but it **is** needed for APK builds.
- The apps ship `lib/` only — no `android/`/`ios/` runners. Generate
  them once on the build machine (see step 3). This is deliberate:
  runners are boilerplate the SDK generates exactly; hand-written
  runners were not committed unverified.

## 2. Verify (no device needed)

```sh
cd apps/customer-mobile && flutter pub get && flutter analyze && flutter test
cd ../driver-mobile && flutter pub get && flutter analyze
```

`flutter analyze` must report no errors. The customer app has a unit
test for fare formatting (`test/fare_test.dart`).

## 3. Build an APK (Android)

```sh
cd apps/customer-mobile
flutter create --platforms=android .   # generates android/ runners only
flutter build apk --release
# APK: build/app/outputs/flutter-apk/app-release.apk
```

Repeat in `apps/driver-mobile`. Install the APK on an Android phone
or emulator. The apps talk to the live API by default.

To point at a local dev server instead (Android emulator reaching the
host), pass:

```sh
flutter build apk --release \
  --dart-define=API_BASE_URL=http://10.0.2.2:3001/api/v1
```

## 4. iOS

iOS builds need macOS + Xcode and are not covered here. The Dart code
is platform-neutral (OSM tiles, no vendor map SDK), so the same `lib/`
builds on iOS once runners are generated on a Mac
(`flutter create --platforms=ios .`).

## 5. First-run checklist (pilot)

1. Admin panel: https://rahi-admin.onrender.com — city **Islamabad**
   is already live (centre 33.6844, 73.0479, PKR, Asia/Karachi).
2. Pricing page: add a CAR NEGOTIATION rule for Islamabad, plus
   BIKE (FIXED) and DELIVERY (HYBRID) rules, before real bookings.
3. Driver app: register → upload CNIC + licence + registration →
   add vehicle → submit → admin approves KYC + vehicle in the panel
   → driver goes online (GPS position is sent with the switch).
4. Customer app: OTP login → tap map for pickup/destination →
   estimate → offer → request → accept a driver offer → trip screen
   (PIN shown once; delivery trips show the recipient OTP).

## 6. Known limits (honest)

- No push notifications exist server-side: the customer polls offers
  every 8s and trip status every 10s; the driver polls incoming
  requests every 10s and `GET /drivers/active-trip` for acceptances.
- The driver app sends GPS every 15s while a trip is live (and
  `POST /drivers/location` while online); background execution rules
  on the phone may throttle this — foreground use is the pilot path.
- SMS OTP is log-only on the server until a Twilio account is wired
  (see `docs/SMS-DELIVERY.md`); OTP codes will not arrive by SMS in
  the pilot until then.
