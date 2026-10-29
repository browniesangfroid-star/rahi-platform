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

const PICKUP = { lat: 31.5204, lng: 74.3587 };
const DEST = { lat: 31.5497, lng: 74.3436 };
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function buildApp() {
  const store = new InMemoryStore();
  const captured = new Map();
  const sms = { sendOtp: async (phone, code) => { captured.set(phone, code); } };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(STORE).useValue(store)
    .overrideProvider(SMS_PROVIDER).useValue(sms)
    .compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();

  const city = await store.createCity({
    name: 'Lahore', countryCode: 'PK', currency: 'PKR', timezone: 'Asia/Karachi',
    centreLat: 31.5204, centreLng: 74.3587,
  });
  for (const [service, mode, base, perKm, perMin, min, fee] of [
    ['CAR', 'NEGOTIATION', 15000, 5000, 500, 20000, 2000],
    ['BIKE', 'FIXED', 8000, 3000, 300, 10000, 1000],
    ['DELIVERY', 'HYBRID', 12000, 4000, 400, 15000, 1500],
  ]) {
    await store.createPricingRule({
      cityId: city.id, serviceCode: service, mode,
      baseFareMinor: base, perKmMinor: perKm, perMinMinor: perMin,
      minimumFareMinor: min, bookingFeeMinor: fee, demandCap: 2.0, version: 1,
    });
  }
  return { app, store, captured };
}

async function login(http, captured, phone) {
  await http.post('/api/v1/auth/request-otp').send({ phone }).expect(201);
  const verified = await http.post('/api/v1/auth/verify-otp')
    .send({ phone, code: captured.get(phone) }).expect(201);
  return verified.body.data.accessToken;
}

async function loginAsAdmin(http, store) {
  const passwordHash = await bcrypt.hash('AdminPass123!', 10);
  const admin = await store.createAdminUser('offers-admin@rahi.test', passwordHash, 'Offers', 'Admin');
  const superRole = await store.createRole('SUPER_ADMIN');
  await store.assignRoleToUser(admin.id, superRole.id);
  const login = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'offers-admin@rahi.test', password: 'AdminPass123!' }).expect(201);
  return login.body.data.accessToken;
}

async function makeApprovedDriver(http, captured, store, adminToken, phone, category) {
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

async function goOnline(http, token, lat, lng) {
  await http.post('/api/v1/drivers/online').set('Authorization', `Bearer ${token}`).send({ lat, lng }).expect(201);
}

async function makeRequest(http, token, body) {
  const res = await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${token}`).send(body).expect(201);
  return res.body.data;
}

test('offers e2e: negotiation flow, one winner, concurrent accepts, decline exclusion', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const customerToken = await login(http, captured, '+923008888001');
    const otherCustomerToken = await login(http, captured, '+923008888002');
    const driverA = await makeApprovedDriver(http, captured, store, adminToken, '+923008888101', 'CAR_ECONOMY');
    const driverB = await makeApprovedDriver(http, captured, store, adminToken, '+923008888102', 'CAR_ECONOMY');
    const driverC = await makeApprovedDriver(http, captured, store, adminToken, '+923008888103', 'CAR_ECONOMY');
    await goOnline(http, driverA.token, 31.5254, 74.3587);
    await goOnline(http, driverB.token, 31.535, 74.36);
    // C is approved but never goes online: not dispatched, cannot offer.
    await goOnline(http, driverC.token, 31.521, 74.359);
    await http.post('/api/v1/drivers/offline').set('Authorization', `Bearer ${driverC.token}`).expect(201);

    const rideReq = await makeRequest(http, customerToken, {
      pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY',
      customerOfferMinor: 40000, paymentMethod: 'CASH',
    });
    assert.equal(rideReq.status, 'OFFERING');

    // Driver incoming list shows the request before any offer.
    const incoming = await http.get('/api/v1/drivers/incoming-requests')
      .set('Authorization', `Bearer ${driverA.token}`).expect(200);
    assert.ok(incoming.body.data.some((r) => r.id === rideReq.id && r.myOffer === null));

    // Not dispatched -> cannot offer. Below minimum -> rejected.
    await http.post(`/api/v1/rides/${rideReq.id}/offers`).set('Authorization', `Bearer ${driverC.token}`)
      .send({ fareMinor: 40000 }).expect(403);
    await http.post(`/api/v1/rides/${rideReq.id}/offers`).set('Authorization', `Bearer ${driverB.token}`)
      .send({ fareMinor: 1000 }).expect(400);

    const offerA = await http.post(`/api/v1/rides/${rideReq.id}/offers`).set('Authorization', `Bearer ${driverA.token}`)
      .send({ fareMinor: 45000 }).expect(201);
    assert.equal(offerA.body.data.status, 'LIVE');
    // One live offer per driver.
    await http.post(`/api/v1/rides/${rideReq.id}/offers`).set('Authorization', `Bearer ${driverA.token}`)
      .send({ fareMinor: 46000 }).expect(409);
    const offerB = await http.post(`/api/v1/rides/${rideReq.id}/offers`).set('Authorization', `Bearer ${driverB.token}`)
      .send({ fareMinor: 38000 }).expect(201);
    // Counter-offer updates the live offer in place.
    const countered = await http.post(`/api/v1/rides/${rideReq.id}/offers/${offerA.body.data.id}/counter`)
      .set('Authorization', `Bearer ${driverA.token}`).send({ fareMinor: 42000 }).expect(201);
    assert.equal(countered.body.data.proposedFareMinor, 42000);
    assert.equal(countered.body.data.counterCount, 1);

    // Another customer cannot accept; the owner can, and only once.
    await http.post(`/api/v1/rides/${rideReq.id}/offers/${offerB.body.data.id}/accept`)
      .set('Authorization', `Bearer ${otherCustomerToken}`).send({}).expect(403);
    const accepted = await http.post(`/api/v1/rides/${rideReq.id}/offers/${offerB.body.data.id}/accept`)
      .set('Authorization', `Bearer ${customerToken}`).send({}).expect(201);
    assert.equal(accepted.body.data.ride.status, 'DRIVER_SELECTED');
    assert.equal(accepted.body.data.ride.finalFareMinor, 38000);
    assert.equal(accepted.body.data.ride.driverId, driverB.userId);
    const after = await http.get(`/api/v1/rides/${rideReq.id}`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(after.body.data.status, 'DRIVER_SELECTED');
    const offers = await http.get(`/api/v1/rides/${rideReq.id}/offers`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    const byId = Object.fromEntries(offers.body.data.map((o) => [o.id, o.status]));
    assert.equal(byId[offerB.body.data.id], 'ACCEPTED');
    assert.equal(byId[offerA.body.data.id], 'SUPERSEDED');
    await http.post(`/api/v1/rides/${rideReq.id}/offers/${offerA.body.data.id}/accept`)
      .set('Authorization', `Bearer ${customerToken}`).send({}).expect(409);

    // Concurrent accepts on a fresh request: exactly one winner.
    const rideReq2 = await makeRequest(http, customerToken, {
      pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY',
      customerOfferMinor: 40000, paymentMethod: 'CASH',
    });
    const offerA2 = await http.post(`/api/v1/rides/${rideReq2.id}/offers`).set('Authorization', `Bearer ${driverA.token}`)
      .send({ fareMinor: 43000 }).expect(201);
    const offerB2 = await http.post(`/api/v1/rides/${rideReq2.id}/offers`).set('Authorization', `Bearer ${driverB.token}`)
      .send({ fareMinor: 39000 }).expect(201);
    const results = await Promise.allSettled([
      http.post(`/api/v1/rides/${rideReq2.id}/offers/${offerA2.body.data.id}/accept`).set('Authorization', `Bearer ${customerToken}`).send({}),
      http.post(`/api/v1/rides/${rideReq2.id}/offers/${offerB2.body.data.id}/accept`).set('Authorization', `Bearer ${customerToken}`).send({}),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value.status === 201);
    const failed = results.filter((r) => r.status === 'fulfilled' && r.value.status === 409);
    assert.equal(succeeded.length, 1);
    assert.equal(failed.length, 1);
    const offers2 = await http.get(`/api/v1/rides/${rideReq2.id}/offers`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(offers2.body.data.filter((o) => o.status === 'ACCEPTED').length, 1);
    assert.equal(await store.getRideByRequestId(rideReq2.id) !== null, true);

    // Decline excludes the driver from offering again on this request.
    const rideReq3 = await makeRequest(http, customerToken, {
      pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY',
      customerOfferMinor: 40000, paymentMethod: 'CASH',
    });
    const offerA3 = await http.post(`/api/v1/rides/${rideReq3.id}/offers`).set('Authorization', `Bearer ${driverA.token}`)
      .send({ fareMinor: 43000 }).expect(201);
    const declined = await http.post(`/api/v1/rides/${rideReq3.id}/offers/${offerA3.body.data.id}/decline`)
      .set('Authorization', `Bearer ${driverA.token}`).send({}).expect(201);
    assert.equal(declined.body.data.status, 'DECLINED');
    await http.post(`/api/v1/rides/${rideReq3.id}/offers`).set('Authorization', `Bearer ${driverA.token}`)
      .send({ fareMinor: 43000 }).expect(409);
    const attempts = await store.listDispatchAttempts(rideReq3.id);
    assert.ok(attempts.some((a) => a.driverUserId === driverA.userId && a.outcome === 'DECLINED'));
  } finally {
    await app.close();
  }
});

test('offers e2e: fixed and hybrid fare rules, expiry', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const customerToken = await login(http, captured, '+923008888201');
    const bikeDriver = await makeApprovedDriver(http, captured, store, adminToken, '+923008888301', 'BIKE');
    const deliveryDriver = await makeApprovedDriver(http, captured, store, adminToken, '+923008888302', 'BIKE');
    await goOnline(http, bikeDriver.token, 31.5254, 74.3587);
    await goOnline(http, deliveryDriver.token, 31.5254, 74.3587);

    // FIXED bike: any driver fare is replaced by the platform fare.
    const bikeReq = await makeRequest(http, customerToken, {
      pickup: PICKUP, destination: DEST, service: 'BIKE', category: 'BIKE', paymentMethod: 'CASH',
    });
    assert.equal(bikeReq.status, 'OFFERING');
    const bikeOffer = await http.post(`/api/v1/rides/${bikeReq.id}/offers`).set('Authorization', `Bearer ${bikeDriver.token}`)
      .send({ fareMinor: 999999 }).expect(201);
    assert.equal(bikeOffer.body.data.proposedFareMinor, bikeReq.suggestedFareMinor);
    await http.post(`/api/v1/rides/${bikeReq.id}/offers/${bikeOffer.body.data.id}/counter`)
      .set('Authorization', `Bearer ${bikeDriver.token}`).send({ fareMinor: 100 }).expect(409);

    // HYBRID delivery: outside ±20% rejected, inside accepted.
    const delReq = await makeRequest(http, customerToken, {
      pickup: PICKUP, destination: DEST, service: 'DELIVERY', paymentMethod: 'CASH', deliveryDetails: { senderName: 'Ali', senderPhone: '+923001111111', recipientName: 'Sara', recipientPhone: '+923002222222', packageCategory: 'PARCEL', sizeWeight: '2 kg', notes: 'Fragile box' },
    });
    const suggested = delReq.suggestedFareMinor;
    await http.post(`/api/v1/rides/${delReq.id}/offers`).set('Authorization', `Bearer ${deliveryDriver.token}`)
      .send({ fareMinor: Math.round(suggested * 0.5) }).expect(400);
    await http.post(`/api/v1/rides/${delReq.id}/offers`).set('Authorization', `Bearer ${deliveryDriver.token}`)
      .send({ fareMinor: Math.round(suggested * 1.1) }).expect(201);

    // Expired request: accept is refused and the request is EXPIRED.
    const expReq = await makeRequest(http, customerToken, {
      pickup: PICKUP, destination: DEST, service: 'BIKE', category: 'BIKE', paymentMethod: 'CASH',
    });
    const expOffer = await http.post(`/api/v1/rides/${expReq.id}/offers`).set('Authorization', `Bearer ${bikeDriver.token}`)
      .send({}).expect(201);
    store.rideRequests.get(expReq.id).expiresAt = new Date(Date.now() - 1000);
    await http.post(`/api/v1/rides/${expReq.id}/offers/${expOffer.body.data.id}/accept`)
      .set('Authorization', `Bearer ${customerToken}`).send({}).expect(409);
    const after = await http.get(`/api/v1/rides/${expReq.id}`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(after.body.data.status, 'EXPIRED');
  } finally {
    await app.close();
  }
});
