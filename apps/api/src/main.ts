import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AppModule } from './app.module';
import { STORE } from './data/store.interface';

/**
 * Dev-only test seed. Runs ONLY when ALL of these hold:
 * - NODE_ENV is not 'production'
 * - DATABASE_URL is unset (in-memory store only — never seeds a real DB)
 * - DEV_ADMIN_EMAIL + DEV_ADMIN_PASSWORD (>= 12 chars) are set
 * Seeds one SUPER_ADMIN, Lahore, and a CAR pricing rule so the admin
 * web app is testable immediately. Skips silently when the admin
 * already exists. Nothing here runs in production.
 */
async function seedDev(app: Awaited<ReturnType<typeof NestFactory.create>>) {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) return;
  const email = process.env.DEV_ADMIN_EMAIL;
  const password = process.env.DEV_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (password.length < 12) {
    // eslint-disable-next-line no-console
    console.warn('[dev-seed] DEV_ADMIN_PASSWORD too short (>= 12 chars) — seed skipped');
    return;
  }
  const store = app.get(STORE);
  if (await store.getUserByEmail(email)) return;
  const city = await store.createCity({
    name: 'Lahore', countryCode: 'PK', currency: 'PKR', timezone: 'Asia/Karachi',
    centreLat: 31.5204, centreLng: 74.3587, isActive: true,
  });
  await store.createPricingRule({
    cityId: city.id, serviceCode: 'CAR', mode: 'NEGOTIATION',
    baseFareMinor: 15000, perKmMinor: 5000, perMinMinor: 500,
    minimumFareMinor: 20000, bookingFeeMinor: 2000, demandCap: 2.0, version: 1,
  });
  const admin = await store.createAdminUser(email, await bcrypt.hash(password, 10), 'Test', 'Admin');
  await store.assignRoleToUser(admin.id, (await store.createRole('SUPER_ADMIN')).id);
  // eslint-disable-next-line no-console
  console.log(`[dev-seed] Test admin ${email} + Lahore seeded (dev only, in-memory)`);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The admin web app calls the API from the browser, so cross-origin
  // requests must be allowed. Development allows all origins (test
  // only). Production allows ONLY the origins in CORS_ORIGINS
  // (comma-separated, e.g. https://rahi-admin.onrender.com) — never
  // ship open CORS in production.
  if (process.env.NODE_ENV !== 'production') {
    app.enableCors();
  } else if (process.env.CORS_ORIGINS) {
    const origins = process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
    if (origins.length > 0) app.enableCors({ origin: origins });
  }
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await seedDev(app);
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Rahi API listening on ${port} (prefix /api/v1)`);
}
void bootstrap();
