// Dev-only demo simulator (Phase 17). Drives the real API through
// one complete journey — customer + driver signup, KYC approval,
// dispatch, offer, accept, PIN trip, completion, rating — and
// prints the numbers. It runs IN-PROCESS against the in-memory
// store and REFUSES to run anywhere near real data:
//
//   - NODE_ENV=production  -> refuse
//   - DATABASE_URL set     -> refuse (that would be a real database)
//
// Run: npm --workspace apps/api run demo
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { AppModule } from '../dist/app.module.js';
import { STORE } from '../dist/data/store.interface.js';
import { InMemoryStore } from '../dist/data/in-memory.store.js';
import { SMS_PROVIDER } from '../dist/auth/sms.provider.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Demo simulator refuses to run with NODE_ENV=production.');
  process.exit(1);
}
if (process.env.DATABASE_URL) {
  console.error('Demo simulator refuses to run with DATABASE_URL set (in-memory only).');
  process.exit(1);
}

const PICKUP = { lat: 31.5204, lng: 74.3587 };
const DEST = { lat: 31.5497, lng: 74.3436 };
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const step = (n) => console.log(`\n[${n}]`);

const store = new InMemoryStore();
const captured = new Map();
const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(STORE).useValue(store)
  .overrideProvider(SMS_PROVIDER).useValue({ sendOtp: async (phone, code) => { captured.set(phone, code); } })
  .compile();
const app = moduleRef.createNestApplication();
app.setGlobalPrefix('api/v1');
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
await app.init();
const http = request(app.getHttpServer());

async function login(phone) {
  await http.post('/api/v1/auth/request-otp').send({ phone }).expect(201);
  const res = await http.post('/api/v1/auth/verify-otp').send({ phone, code: captured.get(phone) }).expect(201);
  return res.body.data.accessToken;
}

try {
  step('Seed demo city + pricing');
  const city = await store.createCity({
    name: 'Lahore (demo)', countryCode: 'PK', currency: 'PKR', timezone: 'Asia/Karachi',
    centreLat: 31.5204, centreLng: 74.3587, isActive: true,
  });
  await store.createPricingRule({
    cityId: city.id, serviceCode: 'CAR', mode: 'NEGOTIATION',
    baseFareMinor: 15000, perKmMinor: 5000, perMinMinor: 500,
    minimumFareMinor: 20000, bookingFeeMinor: 2000, demandCap: 2.0, version: 1,
  });
  const admin = await store.createAdminUser('demo-admin@rahi.test', await bcrypt.hash('DemoPass123!', 10), 'Demo', 'Admin');
  await store.assignRoleToUser(admin.id, (await store.createRole('SUPER_ADMIN')).id);
  const adminLogin = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'demo-admin@rahi.test', password: 'DemoPass123!' }).expect(201);
  const adminToken = adminLogin.body.data.accessToken;
  console.log('Demo admin signed in.');

  step('Driver onboards and passes KYC');
  const driverToken = await login('+923000000001');
  await http.post('/api/v1/drivers/register').set('Authorization', `Bearer ${driverToken}`)
    .send({ bankAccount: 'DEMO-ONLY-0000' }).expect(201);
  for (const type of ['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION']) {
    await http.post('/api/v1/drivers/documents').set('Authorization', `Bearer ${driverToken}`)
      .field('documentType', type).attach('file', jpg, `${type.toLowerCase()}.jpg`).expect(201);
  }
  const vehicle = await http.post('/api/v1/drivers/vehicles').set('Authorization', `Bearer ${driverToken}`)
    .send({ categoryCode: 'CAR_ECONOMY', make: 'Toyota', model: 'Corolla', year: 2021, color: 'White', registrationNumber: 'DEMO-001' }).expect(201);
  const driverId = (await http.get('/api/v1/users/me').set('Authorization', `Bearer ${driverToken}`).expect(200)).body.data.id;
  await http.post('/api/v1/drivers/submit').set('Authorization', `Bearer ${driverToken}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${driverId}/start-review`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/vehicles/${vehicle.body.data.id}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${driverId}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/drivers/vehicles/${vehicle.body.data.id}/activate`).set('Authorization', `Bearer ${driverToken}`).expect(201);
  await http.post('/api/v1/drivers/online').set('Authorization', `Bearer ${driverToken}`)
    .send({ lat: 31.5254, lng: 74.3587 }).expect(201);
  console.log('Driver APPROVED, vehicle active, online.');

  step('Customer requests, driver offers, customer accepts');
  const customerToken = await login('+923000000002');
  const req = await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${customerToken}`)
    .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', paymentMethod: 'CASH' }).expect(201);
  const offer = await http.post(`/api/v1/rides/${req.body.data.id}/offers`).set('Authorization', `Bearer ${driverToken}`)
    .send({ fareMinor: 30000 }).expect(201);
  const accepted = await http.post(`/api/v1/rides/${req.body.data.id}/offers/${offer.body.data.id}/accept`)
    .set('Authorization', `Bearer ${customerToken}`).send({}).expect(201);
  const { ride, pin } = accepted.body.data;
  console.log(`Ride ${ride.id} matched at fare ${ride.finalFareMinor} minor units. Pickup PIN issued (demo only, shown once).`);

  step('Trip: en-route -> arrived -> PIN -> complete');
  for (const action of ['en-route', 'arrived', 'begin-pin-verification']) {
    await http.post(`/api/v1/trips/${ride.id}/${action}`).set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
  }
  await http.post(`/api/v1/trips/${ride.id}/verify-pin`).set('Authorization', `Bearer ${driverToken}`).send({ pin }).expect(201);
  await http.post(`/api/v1/trips/${ride.id}/complete`).set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
  const trip = await http.get(`/api/v1/trips/${ride.id}`).set('Authorization', `Bearer ${customerToken}`).expect(200);
  const finished = trip.body.data.ride;
  console.log(`Trip COMPLETED. Fare ${finished.finalFareMinor}, commission ${finished.commissionMinor} (cash ride: commission is driver debt).`);

  step('Customer rates the driver, admin checks analytics');
  await http.post(`/api/v1/trips/${ride.id}/ratings`).set('Authorization', `Bearer ${customerToken}`).send({ stars: 5 }).expect(201);
  const overview = await http.get('/api/v1/admin/analytics/overview?days=30').set('Authorization', `Bearer ${adminToken}`).expect(200);
  console.log(`Analytics: requested ${overview.body.data.ridesRequested}, completed ${overview.body.data.ridesCompleted}, commission ${overview.body.data.totalCommissionMinor}.`);

  console.log('\nDemo complete. All data above is fake and in-memory only.');
} finally {
  await app.close();
}
