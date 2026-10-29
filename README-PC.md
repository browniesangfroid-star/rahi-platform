# Rahi — run it on your own PC (test package)

This package is the Rahi ride-hailing platform (API + admin web app)
set up to run on your own computer for testing. No Docker, no
database, no hosting needed: everything runs in memory on your PC.

## What you need

- **Node.js 20 or newer** — free from https://nodejs.org (pick the
  LTS version). Check with `node -v` in a terminal.
- Internet for the first run only (to download dependencies).

## How to run it

**Windows:** double-click `start-rahi.bat`. Two windows open
("Rahi API" and "Rahi Admin"). Wait until the Admin window says
"Ready" (first run takes a few minutes: install + build).

**Mac / Linux:** open a terminal in this folder and run:

```sh
./start-rahi.sh
```

(The first time you may need `chmod +x start-rahi.sh`. The API
logs go to `rahi-api.log`; stop everything with Ctrl+C.)

Then open **http://localhost:3000** in your browser and sign in:

- **Email:** admin@rahi.test
- **Password:** af3a83300eef19bdd5cd37f7

This is a TEST login that only exists on your own PC. It is not a
real account and must never be used in production.

## What is already inside

- City **Lahore** (active) with a CAR pricing rule, so the Overview,
  Cities and Pricing pages show real data immediately.
- You can create more cities, pricing rules, and (via the API)
  users, drivers and rides. Everything is stored in memory.

## What does NOT work in this package (on purpose)

- **SMS login for customers/drivers does not send real texts.**
  Phone-OTP login needs a Twilio account (see `docs/SMS-DELIVERY.md`
  in the full project). Admin login with email + password works.
- **All data resets when you stop the servers.** This is a test
  setup, not a production install. Restarting re-seeds Lahore and
  the test admin.
- The Flutter customer/driver apps are NOT in this package — they
  need the Flutter SDK and a phone/emulator (see the main README).

## How to stop it

- Windows: close both the "Rahi API" and "Rahi Admin" windows.
- Mac / Linux: press Ctrl+C in the terminal.

## If it does not start

- **"Port already in use"** — an old run is still open. Close the
  old windows/terminal and try again.
- **Slow first run** — normal. `npm install` downloads a lot.
- **To force a fresh build** — delete the folders `apps/api/dist`
  and `apps/admin-web/.next`, then run the start script again.
- **Node version errors** — upgrade Node.js to 20+ from nodejs.org.

## Where the real docs live

`docs/` in this package has the full architecture, API spec,
business rules, deployment runbook (`docs/DEPLOYMENT.md`) and the
SMS setup guide (`docs/SMS-DELIVERY.md`). The production setup
uses PostgreSQL + Redis + Docker and is a different install from
this test package.
