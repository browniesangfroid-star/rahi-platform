# Rahi — Windows .exe (Desktop Test Edition)

Zero-setup test build: an Electron app that starts the real API and
the real admin web app on the user's PC. No Node.js, no Chocolatey,
no commands. Test-only: in-memory data, resets on close.

## Layout inside the packaged app (`resources/app/`)

- `main.js` — Electron main process. Spawns the API with the
  BUNDLED Node 22 binary (`server/bin/node.exe`, see "Why the
  bundled Node" below) and the admin with `utilityProcess.fork`
  (Electron's bundled Node), waits for both health checks, then
  opens the admin page in its own window. Refuses to run from a
  WinRAR/7-Zip temp folder (extract-first guard).
- `loading.html` — splash screen while servers start.
- `server/bin/node.exe` — official Node 22 LTS win-x64 binary.
- `server/api/dist/` — NestJS API build.
- `server/node_modules/` — API production dependencies only
  (pruned with `npm ci --omit=dev`, then Next/React/Sharp and the
  `@rahi/api`, `@rahi/admin-web` workspace symlinks removed;
  `@rahi/shared-types` is a real copy, not a symlink).
- `server/admin/` — Next.js standalone output (admin build with
  `output: 'standalone'` in `next.config.mjs`), run as
  `node apps/admin-web/server.js` with `PORT=3000`,
  `HOSTNAME=127.0.0.1`.

## Fixed addresses (do not change without rebuilding the admin)

- API: `127.0.0.1:3001` — baked into the admin build via
  `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001/api/v1`.
- Admin: `127.0.0.1:3000`.
- Test admin (dev seed in `apps/api/src/main.ts`, dev only):
  `admin@rahi.test` (password in the delivered INSTALL.txt, never
  in this repo's docs). Seed runs only when `NODE_ENV` is not
  production and `DATABASE_URL` is unset.

## Rebuild steps (on the build VM)

1. `apps/admin-web`: build with
   `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001/api/v1`
   `NEXT_PUBLIC_API_URL=http://127.0.0.1:3001 npm run build`.
2. `apps/api`: `npm run build`.
3. Stage a project copy, `npm ci --omit=dev`, copy its
   `node_modules` (minus Next/React/Sharp, `@types`,
   `caniuse-lite`, `@swc`, `.bin`, and the `@rahi/api` /
   `@rahi/admin-web` symlinks) to `server/node_modules`.
4. Copy API `dist` to `server/api/dist`, standalone output to
   `server/admin`, shared-types real copy to
   `server/node_modules/@rahi/shared-types`.
5. Simulate with plain node first (API + standalone server from
   the staged layout, login + cities checks) — this is the real
   verification; the .exe itself cannot run on the Linux build VM.
6. Package with the POS project's electron-packager
   (Electron 31.7.7, cached win32 zip):
   `electron-packager <appdir> "Rahi" --platform=win32 --arch=x64
   --out=<dir> --overwrite --electron-version=31.7.7`
   (use absolute paths, NOT `~` — the packager does not expand it).
7. Verify `Rahi.exe` is PE32+ GUI x86-64 and `resources/app`
   holds `main.js` + `server/`, then zip with INSTALL.txt.

## Why the bundled Node (root cause found 2026-10-28)

First Windows launch FAILED with the app's readiness-timeout error
page. The user's `api.log` showed `ERR_REQUIRE_ESM`: NestJS 12's
`@nestjs/core` is ESM-only (`"type": "module"`), and Electron 31
bundles Node 20.18, which cannot `require()` an ES module. The
`admin.log` showed Next.js starting fine — only the API was broken.
Fix: the API now runs under the bundled Node 22 LTS binary, which
supports `require(esm)`. (The same log also showed the user had
run `Rahi.exe` from inside the zip via WinRAR temp extraction —
the extract-first guard + INSTALL.txt warning now cover that.)

## Known limits

- The bundled `node.exe` (Windows binary) cannot be executed on
  the Linux build VM, so the API-under-bundled-Node boot is
  verified by the user launching on Windows, not here. Everything
  else (package format, contents, checksums, admin boot, API code
  under Node 24) is verified on the build VM.
- Unsigned: Windows SmartScreen shows once ("More info" →
  "Run anyway").
- Ports 3000/3001 must be free; no fallback (admin bakes the API
  address at build time).
- No real SMS delivery in the test build (log provider default).
- No Postgres/Redis: in-memory store, dev CORS enabled
  (non-production only, see `apps/api/src/main.ts`).
- The final Windows launch itself is only verifiable on a Windows
  PC; everything up to it (servers, login, seeded data, exe
  format) is verified on the build VM.
