import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../dist/app.module.js';
import { STORE } from '../../dist/data/store.interface.js';
import { InMemoryStore } from '../../dist/data/in-memory.store.js';
import { SMS_PROVIDER } from '../../dist/auth/sms.provider.js';
import bcrypt from 'bcryptjs';

const LAHORE_PICKUP = { lat: 31.5204, lng: 74.3587 };
const LAHORE_DEST = { lat: 31.5497, lng: 74.3436 }; // ~3.5 km away

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

  // Pilot city + pricing rules (admin city/pricing UI lands in Phase 13;
  // tests seed via the store, exactly as a dev seed script would).
  const city = await store.createCity({
    name: 'Lahore', countryCode: 'PK', currency: 'PKR', timezone: 'Asia/Karachi',
    centreLat: 31.5204, centreLng: 74.3587,
  });
  await store.createPricingRule({
    cityId: city.id, serviceCode: 'CAR', mode: 'NEGOTIATION',
    baseFareMinor: 15000, perKmMinor: 5000, perMinMinor: 500,
    minimumFareMinor: 20000, bookingFeeMinor: 2000, demandCap: 2.0, version: 1,
  });
  await store.createPricingRule({
    cityId: city.id, serviceCode: 'BIKE', mode: 'FIXED',
    baseFareMinor: 8000, perKmMinor: 3000, perMinMinor: 300,
    minimumFareMinor: 10000, bookingFeeMinor: 1000, demandCap: 1.5, version: 1,
  });
  await store.createPricingRule({
    cityId: city.id, serviceCode: 'DELIVERY', mode: 'HYBRID',
    baseFareMinor: 12000, perKmMinor: 4000, perMinMinor: 400,
    minimumFareMinor: 15000, bookingFeeMinor: 1500, demandCap: 1.5, version: 1,
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
  const admin = await store.createAdminUser('rides-admin@rahi.test', passwordHash, 'Rides', 'Admin');
  const superRole = await store.createRole('SUPER_ADMIN');
  await store.assignRoleToUser(admin.id, superRole.id);
  const login = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'rides-admin@rahi.test', password: 'AdminPass123!' }).expect(201);
  return login.body.data.accessToken;
}

const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function makeOnlineDriver(http, captured, store, adminToken, phone) {
  const token = await login(http, captured, phone);
  await http.post('/api/v1/drivers/register').set('Authorization', `Bearer ${token}`).send({}).expect(201);
  for (const type of ['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION']) {
    await http.post('/api/v1/drivers/documents').set('Authorization', `Bearer ${token}`)
      .field('documentType', type).attach('file', jpg, `${type.toLowerCase()}.jpg`).expect(201);
  }
  const vehicle = await http.post('/api/v1/drivers/vehicles').set('Authorization', `Bearer ${token}`)
    .send({ categoryCode: 'CAR_ECONOMY', make: 'Suzuki', model: 'Alto', year: 2022, color: 'White', registrationNumber: 'LEA-22-9999' }).expect(201);
  const me = await http.get('/api/v1/users/me').set('Authorization', `Bearer ${token}`).expect(200);
  const userId = me.body.data.id;
  await http.post('/api/v1/drivers/submit').set('Authorization', `Bearer ${token}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${userId}/start-review`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/vehicles/${vehicle.body.data.id}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${userId}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/drivers/vehicles/${vehicle.body.data.id}/activate`).set('Authorization', `Bearer ${token}`).expect(201);
  await http.post('/api/v1/drivers/online').set('Authorization', `Bearer ${token}`)
    .send({ lat: 31.5254, lng: 74.3587 }).expect(201);
  return token;
}

test('rides e2e: estimate, pricing modes, request, ownership, cancel, timeline', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const token = await login(http, captured, '+923004444444');
    const otherToken = await login(http, captured, '+923005555555');
    // Phase 7: requests auto-dispatch, so one approved online driver is
    // needed for the request to reach OFFERING (and stay cancellable).
    const adminToken = await loginAsAdmin(http, store);
    await makeOnlineDriver(http, captured, store, adminToken, '+923004444001');

    // Estimate: real distance/fare, breakdown present, mode from rule.
    const est = await http.post('/api/v1/rides/estimate')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickup: LAHORE_PICKUP, destination: LAHORE_DEST, service: 'CAR', category: 'CAR_ECONOMY' }).expect(201);
    assert.ok(est.body.data.distanceKm > 2 && est.body.data.distanceKm < 6);
    assert.ok(est.body.data.suggestedFareMinor >= 20000);
    assert.equal(est.body.data.pricingMode, 'NEGOTIATION');
    assert.ok(est.body.data.fareBreakdown.baseFareMinor === 15000);

    // Service/category mismatch and out-of-area are rejected, not estimated.
    await http.post('/api/v1/rides/estimate')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickup: LAHORE_PICKUP, destination: LAHORE_DEST, service: 'CAR', category: 'BIKE' }).expect(400);
    await http.post('/api/v1/rides/estimate')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickup: { lat: 0, lng: 0 }, destination: LAHORE_DEST, service: 'CAR' }).expect(400);
    await http.post('/api/v1/rides/estimate')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickup: { lat: 100, lng: 74 }, destination: LAHORE_DEST, service: 'CAR' }).expect(400);

    // NEGOTIATION: offer below minimum fare is rejected.
    await http.post('/api/v1/rides/request')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickup: LAHORE_PICKUP, destination: LAHORE_DEST, service: 'CAR', category: 'CAR_ECONOMY', customerOfferMinor: 1000, paymentMethod: 'CASH' }).expect(400);

    // Valid negotiation request.
    const req = await http.post('/api/v1/rides/request')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickup: LAHORE_PICKUP, destination: LAHORE_DEST, service: 'CAR', category: 'CAR_ECONOMY', customerOfferMinor: 40000, paymentMethod: 'CASH' }).expect(201);
    const requestId = req.body.data.id;
    assert.equal(req.body.data.status, 'OFFERING');
    assert.equal(req.body.data.dispatchRound.outcome, 'OFFERING');
    assert.equal(req.body.data.customerOfferMinor, 40000);
    assert.ok(req.body.data.expiresAt);

    // FIXED bike: offer is ignored, platform fare applies.
    const bike = await http.post('/api/v1/rides/request')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickup: LAHORE_PICKUP, destination: LAHORE_DEST, service: 'BIKE', category: 'BIKE', customerOfferMinor: 999999, paymentMethod: 'CASH' }).expect(201);
    assert.equal(bike.body.data.customerOfferMinor, null);

    // HYBRID delivery: offer outside ±20% rejected, inside accepted.
    const hybridEst = await http.post('/api/v1/rides/estimate')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickup: LAHORE_PICKUP, destination: LAHORE_DEST, service: 'DELIVERY' }).expect(201);
    const suggested = hybridEst.body.data.suggestedFareMinor;
    await http.post('/api/v1/rides/request')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickup: LAHORE_PICKUP, destination: LAHORE_DEST, service: 'DELIVERY', customerOfferMinor: Math.round(suggested * 0.5), paymentMethod: 'CASH', deliveryDetails: { senderName: 'Ali', senderPhone: '+923001111111', recipientName: 'Sara', recipientPhone: '+923002222222', packageCategory: 'PARCEL', sizeWeight: '2 kg', notes: 'Fragile box' } }).expect(400);
    await http.post('/api/v1/rides/request')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickup: LAHORE_PICKUP, destination: LAHORE_DEST, service: 'DELIVERY', customerOfferMinor: Math.round(suggested * 1.1), paymentMethod: 'CASH', deliveryDetails: { senderName: 'Ali', senderPhone: '+923001111111', recipientName: 'Sara', recipientPhone: '+923002222222', packageCategory: 'PARCEL', sizeWeight: '2 kg', notes: 'Fragile box' } }).expect(201);

    // Ownership: another user cannot read or cancel.
    await http.get(`/api/v1/rides/${requestId}`).set('Authorization', `Bearer ${otherToken}`).expect(403);
    await http.post(`/api/v1/rides/${requestId}/cancel`).set('Authorization', `Bearer ${otherToken}`).send({}).expect(403);
    const got = await http.get(`/api/v1/rides/${requestId}`).set('Authorization', `Bearer ${token}`).expect(200);
    assert.equal(got.body.data.id, requestId);

    // Timeline contains the SEARCHING creation entry.
    const timeline = await http.get(`/api/v1/rides/${requestId}/timeline`)
      .set('Authorization', `Bearer ${token}`).expect(200);
    assert.equal(timeline.body.data.length, 2);
    assert.equal(timeline.body.data[0].toStatus, 'SEARCHING');
    assert.equal(timeline.body.data[1].toStatus, 'OFFERING');

    // Cancel works once, then is a conflict (terminal state).
    const cancelled = await http.post(`/api/v1/rides/${requestId}/cancel`)
      .set('Authorization', `Bearer ${token}`).send({ reason: 'Changed plans' }).expect(201);
    assert.equal(cancelled.body.data.status, 'CANCELLED_BY_CUSTOMER');
    await http.post(`/api/v1/rides/${requestId}/cancel`)
      .set('Authorization', `Bearer ${token}`).send({}).expect(409);
  } finally {
    await app.close();
  }
});
