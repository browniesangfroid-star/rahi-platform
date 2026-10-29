# SMS delivery — Twilio wired (post-Phase-17 work)

## What changed

SMS is no longer interface-only. The API now ships a real provider
next to the dev-only log provider:

- `apps/api/src/auth/sms.provider.ts` — `SmsProvider` interface
  (`sendOtp(phone, code)`) + `LogSmsProvider` (dev only).
- `apps/api/src/auth/twilio-sms.provider.ts` — `TwilioSmsProvider`,
  plain `fetch` against Twilio's Messages API (no SDK dependency).
  The fetch function is injectable, so tests stub it.
- `apps/api/src/data/data.module.ts` — provider selection from env:

| `SMS_PROVIDER` | Behaviour |
| --- | --- |
| unset or `log` | `LogSmsProvider` + a startup warning. Dev/test default. |
| `twilio` | `TwilioSmsProvider`. Boots fail fast if any Twilio env var is missing. |
| anything else | Boot error (fail fast, no silent fallback). |

## Env vars (server .env only — never in git, never in chat)

```
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=<your auth token>
TWILIO_FROM_NUMBER=+15005550006        # a Twilio number you own,
                                       # or an alphanumeric sender ID (see below)
SMS_BRAND_NAME=Rahi                    # optional, defaults to Rahi
```

## Failure semantics (important)

- A Twilio rejection (bad number, suspended account, …) throws, so
  `POST /auth/otp` fails instead of claiming a code was sent.
  The error carries Twilio's code/message and a *masked* phone
  number — never the OTP code.
- The OTP row is stored *before* the send attempt, so a failed send
  still consumes one OTP rate-limit slot, and a retry generates a
  fresh code (the old one is superseded). This matches the Phase 3
  OTP flow; it is not a retry of the same code.
- Send timeout: 10 seconds (AbortController).

## Activating Twilio (your step — no account was created for you)

1. Sign up at Twilio, upgrade from trial for production.
2. Buy a phone number, or configure a Messaging Service.
3. Copy Account SID + Auth Token from the Twilio console into the
   server `.env` (see above) and restart the API.
4. Send a test OTP to your own number; check the Twilio console
   message log if it does not arrive.

Trial-account limits (from Twilio's docs): trial accounts can only
send to numbers you have verified in the console, and cannot send
from alphanumeric sender IDs — upgrade before pilot testing with
real users.

## Pakistan notes (pilot market)

- Twilio lists Pakistan as supporting alphanumeric sender IDs
  (dynamic, no pre-registration required). Caveat from Twilio's
  Pakistan SMS guidelines: not all Pakistani operators support
  dynamic alphanumeric IDs, and operators may overwrite the sender
  ID with a random short code or generic ID for deliverability.
  So a "Rahi" sender ID is best-effort, not guaranteed to display.
  A Twilio phone number as `TWILIO_FROM_NUMBER` is the reliable
  option; an alphanumeric ID is the nicer-looking one.
- OTP text is English, ASCII-only, under 160 characters (one SMS
  segment). Roman Urdu OTP text is possible later by changing the
  body template in `twilio-sms.provider.ts` — note that non-ASCII
  text switches the message to UCS-2 and shrinks a segment to 70
  characters.
- Prices are per-message on Twilio's Pakistan pricing page; check
  the current rate there before budgeting — no price is quoted
  here because it changes.

## Adding another vendor later (e.g. a local PK gateway)

1. Implement `SmsProvider` in a new file under `apps/api/src/auth/`.
2. Add a branch in the `SMS_PROVIDER` factory in `data.module.ts`
   (fail fast on missing credentials, same as Twilio).
3. Add unit tests with a stubbed transport, same pattern as
   `test/unit/sms.test.mjs`.
4. Document the new env vars here and in `.env.example`.

## What is NOT done

- No Twilio account, number, or credential exists for Rahi yet —
  activation is the deployer's step (above). Until then, any
  deployment without `SMS_PROVIDER=twilio` still logs OTPs only,
  and users cannot log in by SMS.
- The provider is not live-tested against Twilio's real API in
  this VM (no credentials here by design). First real send is a
  staging check: one OTP to a known number, confirmed in the
  Twilio console log.
- SMS cost, delivery-rate monitoring, and a local-gateway
  fallback are not built. If Twilio delivery in Pakistan proves
  unreliable or expensive, the local-gateway route above is the
  next step.

## Tests

`test/unit/sms.test.mjs` (3 tests): request shape + Basic auth +
code in body; non-2xx throws with Twilio code, masked phone, no
code leaked; brand/sender override. Full suite: **41/41** (38
Phase-17 tests + 3 SMS tests).
