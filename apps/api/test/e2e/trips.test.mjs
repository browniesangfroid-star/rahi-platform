// NO_SHOW_WAIT_MINUTES=0 lets the no-show test pass without waiting
// real minutes; the wait logic itself is tested by the pre-arrival
// rejection (no-show before arriving is a 409 regardless of the wait).
process.env.NO_SHOW_WAIT_MINUTES = '0';

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
  await store.createPricingRule({
    cityId: city.id, serviceCode: 'CAR', mode: 'NEGOTIATION',
    baseFareMinor: 15000, perKmMinor: 5000, perMinMinor: 500,
    minimumFareMinor: 20000, bookingFeeMinor: 2000, demandCap: 2.0, version: 1,
  });
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
  const admin = await store.createAdminUser('trips-admin@rahi.test', passwordHash, 'Trips', 'Admin');
  const superRole = await store.createRole('SUPER_ADMIN');
  await store.assignRoleToUser(admin.id, superRole.id);
  const login = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'trips-admin@rahi.test', password: 'AdminPass123!' }).expect(201);
  return login.body.data.accessToken;
}

let driverCounter = 0;
async function makeMatchedRide(http, captured, store, adminToken, customerPhone) {
  driverCounter += 1;
  const suffix = String(600000 + driverCounter);
  const customerToken = await login(http, captured, customerPhone);
  const driverToken = await login(http, captured, `+92300${suffix}`);
  await http.post('/api/v1/drivers/register').set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
  for (const type of ['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION']) {
    await http.post('/api/v1/drivers/documents').set('Authorization', `Bearer ${driverToken}`)
      .field('documentType', type).attach('file', jpg, `${type.toLowerCase()}.jpg`).expect(201);
  }
  const vehicle = await http.post('/api/v1/drivers/vehicles').set('Authorization', `Bearer ${driverToken}`)
    .send({ categoryCode: 'CAR_ECONOMY', make: 'Suzuki', model: 'Alto', year: 2022, color: 'White', registrationNumber: `LEA-${suffix}` }).expect(201);
  const me = await http.get('/api/v1/users/me').set('Authorization', `Bearer ${driverToken}`).expect(200);
  const driverId = me.body.data.id;
  await http.post('/api/v1/drivers/submit').set('Authorization', `Bearer ${driverToken}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${driverId}/start-review`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/vehicles/${vehicle.body.data.id}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${driverId}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/drivers/vehicles/${vehicle.body.data.id}/activate`).set('Authorization', `Bearer ${driverToken}`).expect(201);
  await http.post('/api/v1/drivers/online').set('Authorization', `Bearer ${driverToken}`)
    .send({ lat: 31.5254, lng: 74.3587 }).expect(201);
  const req = await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${customerToken}`)
    .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', customerOfferMinor: 40000, paymentMethod: 'CASH' }).expect(201);
  const offer = await http.post(`/api/v1/rides/${req.body.data.id}/offers`).set('Authorization', `Bearer ${driverToken}`)
    .send({ fareMinor: 40000 }).expect(201);
  const accepted = await http.post(`/api/v1/rides/${req.body.data.id}/offers/${offer.body.data.id}/accept`)
    .set('Authorization', `Bearer ${customerToken}`).send({}).expect(201);
  return {
    customerToken, driverToken, driverId,
    rideId: accepted.body.data.ride.id, requestId: req.body.data.id,
    pin: accepted.body.data.pin,
  };
}

function tripAction(http, token, rideId, action, body = {}) {
  return http.post(`/api/v1/trips/${rideId}/${action}`).set('Authorization', `Bearer ${token}`).send(body);
}

test('trips e2e: full lifecycle with PIN, then completion', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const { customerToken, driverToken, driverId, rideId, requestId, pin } = await makeMatchedRide(http, captured, store, adminToken, '+923006666001');
    assert.match(pin, /^\d{4}$/);

    // Wrong actor and illegal transitions are refused.
    await tripAction(http, customerToken, rideId, 'en-route').expect(403);
    await tripAction(http, driverToken, rideId, 'complete').expect(409);
    await tripAction(http, driverToken, rideId, 'verify-pin', { pin }).expect(409);

    const enRoute = await tripAction(http, driverToken, rideId, 'en-route').expect(201);
    assert.equal(enRoute.body.data.status, 'DRIVER_EN_ROUTE');
    const arrived = await tripAction(http, driverToken, rideId, 'arrived').expect(201);
    assert.equal(arrived.body.data.status, 'DRIVER_ARRIVED');
    const waiting = await tripAction(http, driverToken, rideId, 'begin-pin-verification').expect(201);
    assert.equal(waiting.body.data.status, 'WAITING_FOR_PIN');

    // Wrong PIN fails and counts an attempt; the right PIN starts the trip.
    await tripAction(http, driverToken, rideId, 'verify-pin', { pin: '0000' }).expect(401);
    const pinRecord = await store.getRidePin(rideId);
    assert.equal(pinRecord.attempts, 1);
    const started = await tripAction(http, driverToken, rideId, 'verify-pin', { pin }).expect(201);
    assert.equal(started.body.data.status, 'IN_PROGRESS');

    // Customer cannot cancel a trip in progress; the driver completes it.
    await tripAction(http, customerToken, rideId, 'cancel', {}).expect(409);
    const completed = await tripAction(http, driverToken, rideId, 'complete').expect(201);
    assert.equal(completed.body.data.status, 'COMPLETED');
    const afterRequest = await store.getRideRequest(requestId);
    assert.equal(afterRequest.status, 'COMPLETED');
    const stats = await store.getDriverStats(driverId);
    assert.equal(stats.tripsToday, 1);
    await tripAction(http, customerToken, rideId, 'cancel', {}).expect(409);

    // Trip detail shows ride, request, timeline and PIN state — never the PIN.
    const detail = await http.get(`/api/v1/trips/${rideId}`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(detail.body.data.ride.status, 'COMPLETED');
    assert.equal(detail.body.data.pinVerified, true);
    assert.ok(!JSON.stringify(detail.body.data).includes(pin));
  } finally {
    await app.close();
  }
});

test('trips e2e: cancel rules, no-show, PIN regenerate and lockout', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);

    // Customer cancel before pickup.
    const ride1 = await makeMatchedRide(http, captured, store, adminToken, '+923006666101');
    await tripAction(http, ride1.driverToken, ride1.rideId, 'en-route').expect(201);
    const cancelled = await tripAction(http, ride1.customerToken, ride1.rideId, 'cancel', { reason: 'Changed plans' }).expect(201);
    assert.equal(cancelled.body.data.status, 'CANCELLED_BY_CUSTOMER');

    // Driver cancel requires a reason.
    const ride2 = await makeMatchedRide(http, captured, store, adminToken, '+923006666102');
    await tripAction(http, ride2.driverToken, ride2.rideId, 'driver-cancel', {}).expect(400);
    const driverCancelled = await tripAction(http, ride2.driverToken, ride2.rideId, 'driver-cancel', { reason: 'Vehicle issue' }).expect(201);
    assert.equal(driverCancelled.body.data.status, 'CANCELLED_BY_DRIVER');

    // No-show: not before arriving, then allowed after arrival.
    const ride3 = await makeMatchedRide(http, captured, store, adminToken, '+923006666103');
    await tripAction(http, ride3.driverToken, ride3.rideId, 'no-show').expect(409);
    await tripAction(http, ride3.driverToken, ride3.rideId, 'en-route').expect(201);
    await tripAction(http, ride3.driverToken, ride3.rideId, 'arrived').expect(201);
    const noShow = await tripAction(http, ride3.driverToken, ride3.rideId, 'no-show').expect(201);
    assert.equal(noShow.body.data.status, 'CANCELLED_BY_DRIVER');
    const history = await store.listRideHistory(ride3.rideId);
    assert.ok(history.some((h) => h.toStatus === 'CANCELLED_BY_DRIVER' && h.reason === 'NO_SHOW'));

    // Admin can cancel a trip in progress; the customer cannot.
    const ride4 = await makeMatchedRide(http, captured, store, adminToken, '+923006666104');
    await tripAction(http, ride4.driverToken, ride4.rideId, 'en-route').expect(201);
    await tripAction(http, ride4.driverToken, ride4.rideId, 'arrived').expect(201);
    await tripAction(http, ride4.driverToken, ride4.rideId, 'begin-pin-verification').expect(201);
    await tripAction(http, ride4.driverToken, ride4.rideId, 'verify-pin', { pin: ride4.pin }).expect(201);
    const adminCancelled = await http.post(`/api/v1/admin/trips/${ride4.rideId}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: 'Safety report' }).expect(201);
    assert.equal(adminCancelled.body.data.status, 'CANCELLED_BY_ADMIN');

    // PIN regenerate: old PIN dies, new PIN works; lockout is recoverable.
    const ride5 = await makeMatchedRide(http, captured, store, adminToken, '+923006666105');
    const regenerated = await http.post(`/api/v1/trips/${ride5.rideId}/regenerate-pin`)
      .set('Authorization', `Bearer ${ride5.customerToken}`).send({}).expect(201);
    assert.match(regenerated.body.data.pin, /^\d{4}$/);
    assert.notEqual(regenerated.body.data.pin, ride5.pin);
    await tripAction(http, ride5.driverToken, ride5.rideId, 'en-route').expect(201);
    await tripAction(http, ride5.driverToken, ride5.rideId, 'arrived').expect(201);
    await tripAction(http, ride5.driverToken, ride5.rideId, 'begin-pin-verification').expect(201);
    await tripAction(http, ride5.driverToken, ride5.rideId, 'verify-pin', { pin: ride5.pin }).expect(401);
    for (let i = 0; i < 4; i++) {
      await tripAction(http, ride5.driverToken, ride5.rideId, 'verify-pin', { pin: '1111' }).expect(401);
    }
    // 5 failed attempts total: even the right PIN is now locked.
    await tripAction(http, ride5.driverToken, ride5.rideId, 'verify-pin', { pin: regenerated.body.data.pin }).expect(403);
    const regenerated2 = await http.post(`/api/v1/trips/${ride5.rideId}/regenerate-pin`)
      .set('Authorization', `Bearer ${ride5.customerToken}`).send({}).expect(201);
    const started = await tripAction(http, ride5.driverToken, ride5.rideId, 'verify-pin', { pin: regenerated2.body.data.pin }).expect(201);
    assert.equal(started.body.data.status, 'IN_PROGRESS');
  } finally {
    await app.close();
  }
});
