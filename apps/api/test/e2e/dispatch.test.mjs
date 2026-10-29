import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { AppModule } from '../../dist/app.module.js';
import { STORE } from '../../dist/data/store.interface.js';
import { InMemoryStore } from '../../dist/data/in-memory.store.js';
import { SMS_PROVIDER } from '../../dist/auth/sms.provider.js';
import { LOCATION_INDEX } from '../../dist/dispatch/location-index.js';
import { InMemoryLocationIndex } from '../../dist/dispatch/in-memory-location-index.js';

const PICKUP = { lat: 31.5204, lng: 74.3587 };
const DEST = { lat: 31.5497, lng: 74.3436 };
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function buildApp() {
  const store = new InMemoryStore();
  const index = new InMemoryLocationIndex();
  const captured = new Map();
  const sms = { sendOtp: async (phone, code) => { captured.set(phone, code); } };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(STORE).useValue(store)
    .overrideProvider(SMS_PROVIDER).useValue(sms)
    .overrideProvider(LOCATION_INDEX).useValue(index)
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();

  const city = await store.createCity({
    name: 'Lahore', countryCode: 'PK', currency: 'PKR', timezone: 'Asia/Karachi',
    centreLat: 31.5204, centreLng: 74.3587,
  });
  await store.createPricingRule({
    cityId: city.id, serviceCode: 'CAR', mode: 'NEGOTIATION',
    baseFareMinor: 15000, perKmMinor: 5000, perMinMinor: 500,
    minimumFareMinor: 20000, bookingFeeMinor: 2000, demandCap: 2.0, version: 1,
  });
  return { app, store, captured, index };
}

async function login(http, captured, phone) {
  await http.post('/api/v1/auth/request-otp').send({ phone }).expect(201);
  const verified = await http.post('/api/v1/auth/verify-otp')
    .send({ phone, code: captured.get(phone) }).expect(201);
  return verified.body.data.accessToken;
}

async function loginAsAdmin(http, store) {
  const passwordHash = await bcrypt.hash('AdminPass123!', 10);
  const admin = await store.createAdminUser('dispatch-admin@rahi.test', passwordHash, 'Dispatch', 'Admin');
  const superRole = await store.createRole('SUPER_ADMIN');
  await store.assignRoleToUser(admin.id, superRole.id);
  const login = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'dispatch-admin@rahi.test', password: 'AdminPass123!' }).expect(201);
  return login.body.data.accessToken;
}

async function makeApprovedDriver(http, captured, store, adminToken, phone, category = 'CAR_ECONOMY') {
  const token = await login(http, captured, phone);
  await http.post('/api/v1/drivers/register').set('Authorization', `Bearer ${token}`).send({}).expect(201);
  for (const type of ['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION']) {
    await http.post('/api/v1/drivers/documents').set('Authorization', `Bearer ${token}`)
      .field('documentType', type).attach('file', jpg, `${type.toLowerCase()}.jpg`).expect(201);
  }
  const vehicle = await http.post('/api/v1/drivers/vehicles').set('Authorization', `Bearer ${token}`)
    .send({ categoryCode: category, make: 'Suzuki', model: 'Alto', year: 2022, color: 'White', registrationNumber: `LEA-${phone.slice(-4)}` }).expect(201);
  const me = await http.get('/api/v1/users/me').set('Authorization', `Bearer ${token}`).expect(200);
  const userId = me.body.data.id;
  await http.post('/api/v1/drivers/submit').set('Authorization', `Bearer ${token}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${userId}/start-review`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/vehicles/${vehicle.body.data.id}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${userId}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/drivers/vehicles/${vehicle.body.data.id}/activate`).set('Authorization', `Bearer ${token}`).expect(201);
  return { token, userId };
}

test('dispatch e2e: ranking, exclusions, NO_DRIVER_FOUND, idempotent re-dispatch, offline', async () => {
  const { app, store, captured, index } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const customerToken = await login(http, captured, '+923009999001');

    // A: close, 5.0 rating, no trips. B: farther, 3.0 rating, 5 trips.
    const driverA = await makeApprovedDriver(http, captured, store, adminToken, '+923009999101');
    const driverB = await makeApprovedDriver(http, captured, store, adminToken, '+923009999102');
    const driverD = await makeApprovedDriver(http, captured, store, adminToken, '+923009999103');
    const driverE = await makeApprovedDriver(http, captured, store, adminToken, '+923009999104');
    await store.setDriverStats({ driverUserId: driverA.userId, tripsToday: 0, offersSent: 0, offersAccepted: 0, ratingSum: 50, ratingCount: 10 });
    await store.setDriverStats({ driverUserId: driverB.userId, tripsToday: 5, offersSent: 0, offersAccepted: 0, ratingSum: 30, ratingCount: 10 });

    await http.post('/api/v1/drivers/online').set('Authorization', `Bearer ${driverA.token}`)
      .send({ lat: 31.5254, lng: 74.3587 }).expect(201);
    await http.post('/api/v1/drivers/online').set('Authorization', `Bearer ${driverB.token}`)
      .send({ lat: 31.535, lng: 74.36 }).expect(201);
    await http.post('/api/v1/drivers/online').set('Authorization', `Bearer ${driverD.token}`)
      .send({ lat: 31.521, lng: 74.359 }).expect(201);
    await http.post('/api/v1/drivers/offline').set('Authorization', `Bearer ${driverD.token}`).expect(201);
    await http.post('/api/v1/drivers/online').set('Authorization', `Bearer ${driverE.token}`)
      .send({ lat: 31.521, lng: 74.359 }).expect(201);
    // E's GPS goes stale (10 minutes old) — must not be matched.
    index.drivers.get(driverE.userId).lastSeen = new Date(Date.now() - 10 * 60 * 1000);

    // C: unapproved driver. Going online is refused, and even a location
    // forced into the index must not be matched (store KYC filter).
    const driverC = await login(http, captured, '+923009999105');
    await http.post('/api/v1/drivers/register').set('Authorization', `Bearer ${driverC}`).send({}).expect(201);
    const meC = await http.get('/api/v1/users/me').set('Authorization', `Bearer ${driverC}`).expect(200);
    await http.post('/api/v1/drivers/online').set('Authorization', `Bearer ${driverC}`)
      .send({ lat: 31.5205, lng: 74.3588 }).expect(409);
    await index.setDriver({
      driverId: meC.body.data.id, cityId: null, categoryCode: 'CAR_ECONOMY',
      lat: 31.5205, lng: 74.3588, lastSeen: new Date(), online: true,
      rating: 5.0, acceptanceRate: 1.0, tripsToday: 0,
    });

    // Request 1: A and B matched, A ranked first, C/D/E excluded.
    const req1 = await http.post('/api/v1/rides/request')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', customerOfferMinor: 40000, paymentMethod: 'CASH' }).expect(201);
    assert.equal(req1.body.data.status, 'OFFERING');
    assert.equal(req1.body.data.dispatchRound.outcome, 'OFFERING');
    assert.equal(req1.body.data.dispatchRound.radiusKm, 2);
    const candidateIds = req1.body.data.dispatchRound.candidates.map((c) => c.driverUserId);
    assert.deepEqual(candidateIds, [driverA.userId, driverB.userId]);
    assert.ok(req1.body.data.dispatchRound.candidates[0].score > req1.body.data.dispatchRound.candidates[1].score);

    // Re-dispatch is idempotent: no duplicate attempts.
    const attemptsBefore = await store.listDispatchAttempts(req1.body.data.id);
    const redispatch = await http.post(`/api/v1/admin/dispatch/${req1.body.data.id}/run`)
      .set('Authorization', `Bearer ${adminToken}`).expect(201);
    assert.equal(redispatch.body.data.outcome, 'ALREADY_DISPATCHED');
    const attemptsAfter = await store.listDispatchAttempts(req1.body.data.id);
    assert.equal(attemptsAfter.length, attemptsBefore.length);

    // A goes offline: a new request at the same pickup matches only B.
    await http.post('/api/v1/drivers/offline').set('Authorization', `Bearer ${driverA.token}`).expect(201);
    const req2 = await http.post('/api/v1/rides/request')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', customerOfferMinor: 40000, paymentMethod: 'CASH' }).expect(201);
    assert.deepEqual(req2.body.data.dispatchRound.candidates.map((c) => c.driverUserId), [driverB.userId]);

    // A request 20 km away finds nobody in any radius.
    const farPickup = { lat: 31.70, lng: 74.50 };
    const req3 = await http.post('/api/v1/rides/request')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ pickup: farPickup, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', customerOfferMinor: 40000, paymentMethod: 'CASH' }).expect(201);
    assert.equal(req3.body.data.status, 'NO_DRIVER_FOUND');
    assert.equal(req3.body.data.dispatchRound.outcome, 'NO_DRIVER_FOUND');

    // Live drivers: B only (A and D offline, E stale is still listed as
    // online by the index but is never matched — see the note in the doc).
    const live = await http.get('/api/v1/admin/live-drivers')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    const liveIds = live.body.data.map((d) => d.driverId);
    assert.ok(liveIds.includes(driverB.userId));
    assert.ok(!liveIds.includes(driverA.userId));
    assert.ok(!liveIds.includes(driverD.userId));
  } finally {
    await app.close();
  }
});
