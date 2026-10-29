// First-admin bootstrap for staging/production (Phase 17).
// There is deliberately no API endpoint that creates admins out of
// thin air, and no production password anywhere in the repo. Run
// this once, from an operator shell, after migrations:
//
//   DATABASE_URL=postgres://... ADMIN_EMAIL=ops@example.com \
//     ADMIN_PASSWORD='<at least 12 chars>' \
//     node scripts/create-admin.mjs
//
// The password is read from the environment only, never printed,
// and never written to a file. Re-running for an existing email
// refuses instead of overwriting.
import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { PostgresStore } from '../dist/data/postgres.store.js';

const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required (Postgres only).');
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required.');
  process.exit(1);
}
if (ADMIN_PASSWORD.length < 12) {
  console.error('ADMIN_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

const store = new PostgresStore(DATABASE_URL);
const existing = await store.getUserByEmail(ADMIN_EMAIL);
if (existing) {
  console.error(`An admin already exists for ${ADMIN_EMAIL}; refusing to overwrite.`);
  process.exit(1);
}
const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
const admin = await store.createAdminUser(
  ADMIN_EMAIL,
  passwordHash,
  process.env.ADMIN_FIRST_NAME ?? 'Admin',
  process.env.ADMIN_LAST_NAME ?? 'Admin',
);
const role = await store.createRole('SUPER_ADMIN');
await store.assignRoleToUser(admin.id, role.id);
console.log(`Created SUPER_ADMIN ${ADMIN_EMAIL} (id ${admin.id}). Sign in at /auth/admin/login, then enable MFA.`);
process.exit(0);
