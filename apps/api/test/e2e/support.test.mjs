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
    centreLat: 31.5204, centreLng: 74.3587, isActive: true,
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
  const admin = await store.createAdminUser('support-admin@rahi.test', passwordHash, 'Support', 'Admin');
  const superRole = await store.createRole('SUPER_ADMIN');
  await store.assignRoleToUser(admin.id, superRole.id);
  const login = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'support-admin@rahi.test', password: 'AdminPass123!' }).expect(201);
  return login.body.data.accessToken;
}

let courierCounter = 0;
async function makeApprovedDriver(http, captured, adminToken) {
  courierCounter += 1;
  const suffix = String(900000 + courierCounter);
  const token = await login(http, captured, `+92300${suffix}`);
  await http.post('/api/v1/drivers/register').set('Authorization', `Bearer ${token}`).send({}).expect(201);
  for (const type of ['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION']) {
    await http.post('/api/v1/drivers/documents').set('Authorization', `Bearer ${token}`)
      .field('documentType', type).attach('file', jpg, `${type.toLowerCase()}.jpg`).expect(201);
  }
  const vehicle = await http.post('/api/v1/drivers/vehicles').set('Authorization', `Bearer ${token}`)
    .send({ categoryCode: 'CAR_ECONOMY', make: 'Toyota', model: 'Corolla', year: 2021, color: 'White', registrationNumber: `LEB-${suffix}` }).expect(201);
  const me = await http.get('/api/v1/users/me').set('Authorization', `Bearer ${token}`).expect(200);
  const driverId = me.body.data.id;
  await http.post('/api/v1/drivers/submit').set('Authorization', `Bearer ${token}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${driverId}/start-review`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/vehicles/${vehicle.body.data.id}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${driverId}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/drivers/vehicles/${vehicle.body.data.id}/activate`).set('Authorization', `Bearer ${token}`).expect(201);
  await http.post('/api/v1/drivers/online').set('Authorization', `Bearer ${token}`)
    .send({ lat: 31.5254, lng: 74.3587 }).expect(201);
  return { token, driverId };
}

async function makeMatchedRide(http, captured, customerPhone, driver) {
  const customerToken = await login(http, captured, customerPhone);
  const req = await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${customerToken}`)
    .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', paymentMethod: 'CASH' }).expect(201);
  const offer = await http.post(`/api/v1/rides/${req.body.data.id}/offers`).set('Authorization', `Bearer ${driver.token}`)
    .send({ fareMinor: 30000 }).expect(201);
  const accepted = await http.post(`/api/v1/rides/${req.body.data.id}/offers/${offer.body.data.id}/accept`)
    .set('Authorization', `Bearer ${customerToken}`).send({}).expect(201);
  return { customerToken, rideId: accepted.body.data.ride.id, pin: accepted.body.data.pin };
}

async function completeRide(http, rideId, driverToken, pin) {
  await http.post(`/api/v1/trips/${rideId}/en-route`).set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
  await http.post(`/api/v1/trips/${rideId}/arrived`).set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
  await http.post(`/api/v1/trips/${rideId}/begin-pin-verification`).set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
  await http.post(`/api/v1/trips/${rideId}/verify-pin`).set('Authorization', `Bearer ${driverToken}`).send({ pin }).expect(201);
  await http.post(`/api/v1/trips/${rideId}/complete`).set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
}

test('support e2e: ratings rules, aggregates, and report auto-ticket', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const driver = await makeApprovedDriver(http, captured, adminToken);

    // Rating a non-completed ride is refused.
    const early = await makeMatchedRide(http, captured, '+923008888001', driver);
    await http.post(`/api/v1/trips/${early.rideId}/ratings`).set('Authorization', `Bearer ${early.customerToken}`)
      .send({ stars: 5 }).expect(409);

    await completeRide(http, early.rideId, driver.token, early.pin);
    // A report rating opens a ticket automatically and updates aggregates.
    const rated = await http.post(`/api/v1/trips/${early.rideId}/ratings`).set('Authorization', `Bearer ${early.customerToken}`)
      .send({ stars: 4, comment: 'Good drive', reportReason: 'Driver was rude at drop-off' }).expect(201);
    assert.ok(rated.body.data.ticket);
    assert.equal(rated.body.data.ticket.category, 'REPORT');
    assert.equal(rated.body.data.ticket.status, 'OPEN');
    const stats = await store.getDriverStats(driver.driverId);
    assert.equal(stats.ratingSum, 4);
    assert.equal(stats.ratingCount, 1);
    // Second rating in the same direction is refused.
    await http.post(`/api/v1/trips/${early.rideId}/ratings`).set('Authorization', `Bearer ${early.customerToken}`)
      .send({ stars: 5 }).expect(409);
    // The driver rating the customer back works (opposite direction).
    await http.post(`/api/v1/trips/${early.rideId}/ratings`).set('Authorization', `Bearer ${driver.token}`)
      .send({ stars: 5 }).expect(201);
    // Support can see the auto-ticket and close the loop.
    const tickets = await http.get('/api/v1/support/tickets').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const ticket = tickets.body.data.find((t) => t.id === rated.body.data.ticket.id);
    assert.ok(ticket);
    await http.post(`/api/v1/support/tickets/${ticket.id}/status`).set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RESOLVED' }).expect(201);
    const detail = await http.get(`/api/v1/support/tickets/${ticket.id}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(detail.body.data.ticket.status, 'RESOLVED');
    assert.ok(detail.body.data.messages.some((m) => m.message.includes('rude')));

    // The 7-day window is enforced (completion backdated in the store).
    const late = await makeMatchedRide(http, captured, '+923008888002', driver);
    await completeRide(http, late.rideId, driver.token, late.pin);
    const history = await store.listRideHistory(late.rideId);
    const completedEntry = history.find((h) => h.toStatus === 'COMPLETED');
    completedEntry.createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await http.post(`/api/v1/trips/${late.rideId}/ratings`).set('Authorization', `Bearer ${late.customerToken}`)
      .send({ stars: 5 }).expect(409);
  } finally {
    await app.close();
  }
});

test('support e2e: SOS snapshot + resolve, share link privacy + revoke, admin PIN reset', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const driver = await makeApprovedDriver(http, captured, adminToken);
    const ride = await makeMatchedRide(http, captured, '+923008888101', driver);
    await http.post(`/api/v1/rides/${ride.rideId}/location`).set('Authorization', `Bearer ${driver.token}`)
      .send({ lat: 31.5300, lng: 74.3600 }).expect(201);

    // SOS snapshots the live trip; a second SOS returns the same incident.
    const sos = await http.post(`/api/v1/trips/${ride.rideId}/sos`).set('Authorization', `Bearer ${ride.customerToken}`)
      .send({ note: 'Feel unsafe' }).expect(201);
    assert.equal(sos.body.data.priority, 'HIGH');
    assert.equal(sos.body.data.status, 'OPEN');
    const snapshot = JSON.parse(sos.body.data.snapshot);
    assert.equal(snapshot.lastLocation.lat, 31.53);
    assert.equal(snapshot.driverId, driver.driverId);
    const sos2 = await http.post(`/api/v1/trips/${ride.rideId}/sos`).set('Authorization', `Bearer ${ride.customerToken}`)
      .send({}).expect(201);
    assert.equal(sos2.body.data.id, sos.body.data.id);
    await http.post(`/api/v1/support/incidents/${sos.body.data.id}/resolve`).set('Authorization', `Bearer ${adminToken}`)
      .send({ resolutionNote: 'Called customer, all clear' }).expect(201);

    // Share link: public view shows status + location only, never
    // phone numbers or names.
    const share = await http.post(`/api/v1/trips/${ride.rideId}/share`).set('Authorization', `Bearer ${ride.customerToken}`)
      .send({ ttlMinutes: 60 }).expect(201);
    const shared = await request(app.getHttpServer()).get(`/api/v1/share/${share.body.data.token}`).expect(200);
    assert.equal(shared.body.data.status, 'DRIVER_SELECTED');
    assert.equal(shared.body.data.latestLocation.lat, 31.53);
    assert.ok(!JSON.stringify(shared.body.data).includes('+92300'));
    assert.ok(!JSON.stringify(shared.body.data).includes('888101'));
    await http.delete(`/api/v1/trips/${ride.rideId}/share/${share.body.data.id}`)
      .set('Authorization', `Bearer ${ride.customerToken}`).expect(200);
    await request(app.getHttpServer()).get(`/api/v1/share/${share.body.data.token}`).expect(410);

    // Admin PIN reset: old PIN stops working, fresh PIN verifies.
    await http.post(`/api/v1/trips/${ride.rideId}/en-route`).set('Authorization', `Bearer ${driver.token}`).send({}).expect(201);
    await http.post(`/api/v1/trips/${ride.rideId}/arrived`).set('Authorization', `Bearer ${driver.token}`).send({}).expect(201);
    await http.post(`/api/v1/trips/${ride.rideId}/begin-pin-verification`).set('Authorization', `Bearer ${driver.token}`).send({}).expect(201);
    const reset = await http.post(`/api/v1/admin/trips/${ride.rideId}/reset-pin`)
      .set('Authorization', `Bearer ${adminToken}`).send({}).expect(201);
    assert.notEqual(reset.body.data.pin, ride.pin);
    await http.post(`/api/v1/trips/${ride.rideId}/verify-pin`).set('Authorization', `Bearer ${driver.token}`)
      .send({ pin: ride.pin }).expect(401);
    await http.post(`/api/v1/trips/${ride.rideId}/verify-pin`).set('Authorization', `Bearer ${driver.token}`)
      .send({ pin: reset.body.data.pin }).expect(201);
  } finally {
    await app.close();
  }
});

test('support e2e: review queue flags repeat cancellations; suspend/unsuspend works', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const driver = await makeApprovedDriver(http, captured, adminToken);
    const customerPhone = '+923008888201';
    for (let i = 0; i < 3; i++) {
      const ride = await makeMatchedRide(http, captured, customerPhone, driver);
      await http.post(`/api/v1/trips/${ride.rideId}/cancel`)
        .set('Authorization', `Bearer ${ride.customerToken}`).send({ reason: 'Changed my mind' }).expect(201);
    }
    const queue = await http.get('/api/v1/admin/support/review-queue').set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(queue.body.data.length, 3);
    assert.ok(queue.body.data.every((e) => e.flaggedRepeat === true));
    assert.ok(queue.body.data.every((e) => e.cancelCount7d === 3));
    assert.ok(queue.body.data.every((e) => e.reason === 'Changed my mind'));

    // A plain user cannot open the queue.
    const userToken = await login(http, captured, '+923008888299');
    await http.get('/api/v1/admin/support/review-queue').set('Authorization', `Bearer ${userToken}`).expect(403);

    // Suspend + unsuspend round-trip on the cancelling customer.
    const customerToken = await login(http, captured, customerPhone);
    const me = await http.get('/api/v1/users/me').set('Authorization', `Bearer ${customerToken}`).expect(200);
    const suspended = await http.patch(`/api/v1/admin/users/${me.body.data.id}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: 'Repeated cancellations' }).expect(200);
    assert.equal(suspended.body.data.status, 'SUSPENDED');
    const restored = await http.patch(`/api/v1/admin/users/${me.body.data.id}/unsuspend`)
      .set('Authorization', `Bearer ${adminToken}`).send({}).expect(200);
    assert.equal(restored.body.data.status, 'ACTIVE');
  } finally {
    await app.close();
  }
});
