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
  return { app, store, captured, cityId: city.id };
}

async function login(http, captured, phone) {
  await http.post('/api/v1/auth/request-otp').send({ phone }).expect(201);
  const verified = await http.post('/api/v1/auth/verify-otp')
    .send({ phone, code: captured.get(phone) }).expect(201);
  return verified.body.data.accessToken;
}

async function loginAsAdmin(http, store) {
  const passwordHash = await bcrypt.hash('AdminPass123!', 10);
  const admin = await store.createAdminUser('analytics-admin@rahi.test', passwordHash, 'Analytics', 'Admin');
  const superRole = await store.createRole('SUPER_ADMIN');
  await store.assignRoleToUser(admin.id, superRole.id);
  const login = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'analytics-admin@rahi.test', password: 'AdminPass123!' }).expect(201);
  return login.body.data.accessToken;
}

let driverCounter = 0;
async function makeApprovedDriver(http, captured, adminToken) {
  driverCounter += 1;
  const suffix = String(910000 + driverCounter);
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
  return { customerToken, rideId: accepted.body.data.ride.id, pin: accepted.body.data.pin, requestId: req.body.data.id };
}

async function completeRide(http, rideId, driverToken, pin) {
  await http.post(`/api/v1/trips/${rideId}/en-route`).set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
  await http.post(`/api/v1/trips/${rideId}/arrived`).set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
  await http.post(`/api/v1/trips/${rideId}/begin-pin-verification`).set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
  await http.post(`/api/v1/trips/${rideId}/verify-pin`).set('Authorization', `Bearer ${driverToken}`).send({ pin }).expect(201);
  await http.post(`/api/v1/trips/${rideId}/complete`).set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
}

test('analytics e2e: overview, dispatch, cities, leaderboard, daily, fairness agree', async () => {
  const { app, store, captured, cityId } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const driver = await makeApprovedDriver(http, captured, adminToken);

    const rideA = await makeMatchedRide(http, captured, '+923008889001', driver);
    await completeRide(http, rideA.rideId, driver.token, rideA.pin);
    const rideB = await makeMatchedRide(http, captured, '+923008889002', driver);
    await completeRide(http, rideB.rideId, driver.token, rideB.pin);
    // One matched ride cancelled by its customer.
    const rideC = await makeMatchedRide(http, captured, '+923008889003', driver);
    await http.post(`/api/v1/trips/${rideC.rideId}/cancel`)
      .set('Authorization', `Bearer ${rideC.customerToken}`).send({ reason: 'Changed my mind' }).expect(201);
    // One request cancelled before matching.
    const customerD = await login(http, captured, '+923008889004');
    const reqD = await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${customerD}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', paymentMethod: 'CASH' }).expect(201);
    await http.post(`/api/v1/rides/${reqD.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${customerD}`).send({}).expect(201);
    // Ratings on both completed rides.
    await http.post(`/api/v1/trips/${rideA.rideId}/ratings`).set('Authorization', `Bearer ${rideA.customerToken}`).send({ stars: 5 }).expect(201);
    await http.post(`/api/v1/trips/${rideB.rideId}/ratings`).set('Authorization', `Bearer ${rideB.customerToken}`).send({ stars: 4 }).expect(201);

    const auth = (r) => r.set('Authorization', `Bearer ${adminToken}`);
    const overview = await auth(http.get('/api/v1/admin/analytics/overview?days=30')).expect(200);
    assert.equal(overview.body.data.ridesRequested, 4);
    assert.equal(overview.body.data.ridesCompleted, 2);
    assert.equal(overview.body.data.ridesCancelled, 2);
    assert.equal(overview.body.data.completionRate, 0.5);
    assert.equal(overview.body.data.avgFareMinor, 30000);
    // Fare 30000, booking fee 2000, 15% of 28000 = 4200 per ride.
    assert.equal(overview.body.data.totalCommissionMinor, 8400);
    assert.equal(overview.body.data.offerAcceptanceRate, 1);

    const dispatch = await auth(http.get('/api/v1/admin/analytics/dispatch?days=30')).expect(200);
    assert.ok(dispatch.body.data.attempts >= 4);
    // Matched offers flip their attempt to ACCEPTED; the pre-match
    // cancelled request keeps its attempt OFFERED.
    assert.equal(dispatch.body.data.byOutcome.ACCEPTED, 3);
    assert.ok((dispatch.body.data.byOutcome.OFFERED ?? 0) >= 1);
    assert.ok(dispatch.body.data.avgScore !== null);
    assert.ok(dispatch.body.data.byRadiusKm['2'] >= 4);
    assert.ok(dispatch.body.data.avgMatchSeconds !== null);
    assert.equal(dispatch.body.data.offersSent, 3);
    assert.equal(dispatch.body.data.offersAccepted, 3);

    const cities = await auth(http.get('/api/v1/admin/analytics/cities?days=30')).expect(200);
    const lahore = cities.body.data.find((c) => c.cityId === cityId);
    assert.equal(lahore.requested, 4);
    assert.equal(lahore.completed, 2);
    assert.equal(lahore.commissionMinor, 8400);
    assert.equal(lahore.avgFareMinor, 30000);

    const leaders = await auth(http.get('/api/v1/admin/analytics/drivers?days=30')).expect(200);
    assert.equal(leaders.body.data[0].driverUserId, driver.driverId);
    assert.equal(leaders.body.data[0].completedRides, 2);
    assert.equal(leaders.body.data[0].earningsMinor, 51600);
    assert.equal(leaders.body.data[0].avgRating, 4.5);
    assert.equal(leaders.body.data[0].acceptanceRate, 1);

    const daily = await auth(http.get('/api/v1/admin/analytics/daily?days=30')).expect(200);
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = daily.body.data.find((d) => d.date === today);
    assert.equal(todayRow.requested, 4);
    assert.equal(todayRow.completed, 2);
    assert.equal(todayRow.commissionMinor, 8400);

    const fairness = await auth(http.get(`/api/v1/admin/analytics/fairness/${cityId}`)).expect(200);
    assert.equal(fairness.body.data.cityMaxTripsToday, 2);
    assert.equal(fairness.body.data.drivers.find((d) => d.driverUserId === driver.driverId).tripsToday, 2);

    // Guardrails: plain user refused, bad window refused, unknown city 404.
    const userToken = await login(http, captured, '+923008889099');
    await http.get('/api/v1/admin/analytics/overview').set('Authorization', `Bearer ${userToken}`).expect(403);
    await auth(http.get('/api/v1/admin/analytics/overview?days=0')).expect(400);
    await auth(http.get('/api/v1/admin/analytics/fairness/00000000-0000-0000-0000-000000000000')).expect(404);
  } finally {
    await app.close();
  }
});

test('analytics e2e: city-max fairness ranks a fresh driver above a busy one', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const busy = await makeApprovedDriver(http, captured, adminToken);
    const fresh = await makeApprovedDriver(http, captured, adminToken);
    // Busy driver runs two trips in the city today.
    for (const phone of ['+923008889101', '+923008889102']) {
      const ride = await makeMatchedRide(http, captured, phone, busy);
      await completeRide(http, ride.rideId, busy.token, ride.pin);
    }
    // Equalise everything except city-day trips: same rating (none),
    // same acceptance (2 sent / 2 accepted each).
    await store.setDriverStats({ driverUserId: busy.driverId, tripsToday: 2, offersSent: 2, offersAccepted: 2, ratingSum: 0, ratingCount: 0 });
    await store.setDriverStats({ driverUserId: fresh.driverId, tripsToday: 0, offersSent: 2, offersAccepted: 2, ratingSum: 0, ratingCount: 0 });

    // A new request auto-dispatches; attempts are recorded in score order.
    const customerToken = await login(http, captured, '+923008889103');
    const req = await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${customerToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', paymentMethod: 'CASH' }).expect(201);
    const attempts = await store.listDispatchAttempts(req.body.data.id);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].driverUserId, fresh.driverId);
    assert.equal(attempts[1].driverUserId, busy.driverId);
    assert.ok(attempts[0].score > attempts[1].score);
  } finally {
    await app.close();
  }
});
