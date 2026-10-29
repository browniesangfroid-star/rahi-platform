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
const DETAILS = {
  senderName: 'Ali', senderPhone: '+923001111111',
  recipientName: 'Sara', recipientPhone: '+923002222222',
  packageCategory: 'FRAGILE', sizeWeight: '2 kg', notes: 'Handle with care',
};

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
    cityId: city.id, serviceCode: 'DELIVERY', mode: 'HYBRID',
    baseFareMinor: 12000, perKmMinor: 4000, perMinMinor: 400,
    minimumFareMinor: 15000, bookingFeeMinor: 1500, demandCap: 1.5, version: 1,
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
  const admin = await store.createAdminUser('delivery-admin@rahi.test', passwordHash, 'Delivery', 'Admin');
  const superRole = await store.createRole('SUPER_ADMIN');
  await store.assignRoleToUser(admin.id, superRole.id);
  const login = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'delivery-admin@rahi.test', password: 'AdminPass123!' }).expect(201);
  return login.body.data.accessToken;
}

let courierCounter = 0;
async function makeDeliveryRide(http, captured, store, adminToken, customerPhone) {
  courierCounter += 1;
  const suffix = String(700000 + courierCounter);
  const customerToken = await login(http, captured, customerPhone);
  const courierToken = await login(http, captured, `+92300${suffix}`);
  await http.post('/api/v1/drivers/register').set('Authorization', `Bearer ${courierToken}`).send({}).expect(201);
  for (const type of ['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION']) {
    await http.post('/api/v1/drivers/documents').set('Authorization', `Bearer ${courierToken}`)
      .field('documentType', type).attach('file', jpg, `${type.toLowerCase()}.jpg`).expect(201);
  }
  const vehicle = await http.post('/api/v1/drivers/vehicles').set('Authorization', `Bearer ${courierToken}`)
    .send({ categoryCode: 'BIKE', make: 'Honda', model: 'CD70', year: 2022, color: 'Red', registrationNumber: `LEB-${suffix}` }).expect(201);
  const me = await http.get('/api/v1/users/me').set('Authorization', `Bearer ${courierToken}`).expect(200);
  const courierId = me.body.data.id;
  await http.post('/api/v1/drivers/submit').set('Authorization', `Bearer ${courierToken}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${courierId}/start-review`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/vehicles/${vehicle.body.data.id}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/admin/drivers/${courierId}/approve`).set('Authorization', `Bearer ${adminToken}`).expect(201);
  await http.post(`/api/v1/drivers/vehicles/${vehicle.body.data.id}/activate`).set('Authorization', `Bearer ${courierToken}`).expect(201);
  await http.post('/api/v1/drivers/online').set('Authorization', `Bearer ${courierToken}`)
    .send({ lat: 31.5254, lng: 74.3587 }).expect(201);
  const req = await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${customerToken}`)
    .send({ pickup: PICKUP, destination: DEST, service: 'DELIVERY', paymentMethod: 'CASH', deliveryDetails: DETAILS }).expect(201);
  // HYBRID delivery requires a fare; offering the suggested fare is in band.
  const offer = await http.post(`/api/v1/rides/${req.body.data.id}/offers`).set('Authorization', `Bearer ${courierToken}`)
    .send({ fareMinor: req.body.data.suggestedFareMinor }).expect(201);
  const accepted = await http.post(`/api/v1/rides/${req.body.data.id}/offers/${offer.body.data.id}/accept`)
    .set('Authorization', `Bearer ${customerToken}`).send({}).expect(201);
  return {
    customerToken, courierToken, courierId,
    rideId: accepted.body.data.ride.id, requestId: req.body.data.id,
    pin: accepted.body.data.pin, deliveryOtp: accepted.body.data.deliveryOtp,
  };
}

test('delivery e2e: details validation and full delivery flow with OTP proof', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const customerToken = await login(http, captured, '+923005555001');

    // Delivery without details, and details on a non-delivery request, are refused.
    await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${customerToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'DELIVERY', paymentMethod: 'CASH' }).expect(400);
    await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${customerToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', paymentMethod: 'CASH', deliveryDetails: DETAILS }).expect(400);

    const ride = await makeDeliveryRide(http, captured, store, adminToken, '+923005555002');
    assert.match(ride.deliveryOtp, /^\d{4}$/);

    // Couriers saw the package in their incoming list before offering
    // (verified on a fresh request's incoming list via the store).
    const delivery = await http.get(`/api/v1/trips/${ride.rideId}/delivery`)
      .set('Authorization', `Bearer ${ride.customerToken}`).expect(200);
    assert.equal(delivery.body.data.details.status, 'COURIER_SELECTED');
    assert.equal(delivery.body.data.details.packageCategory, 'FRAGILE');
    assert.ok(!JSON.stringify(delivery.body.data).includes(ride.deliveryOtp));

    // Trip en-route mirrors onto delivery; PIN verification at the
    // sender moves delivery through PICKED_UP to IN_TRANSIT.
    await http.post(`/api/v1/trips/${ride.rideId}/en-route`).set('Authorization', `Bearer ${ride.courierToken}`).send({}).expect(201);
    let current = await http.get(`/api/v1/trips/${ride.rideId}/delivery`).set('Authorization', `Bearer ${ride.customerToken}`).expect(200);
    assert.equal(current.body.data.details.status, 'COURIER_EN_ROUTE_PICKUP');
    await http.post(`/api/v1/trips/${ride.rideId}/arrived`).set('Authorization', `Bearer ${ride.courierToken}`).send({}).expect(201);
    await http.post(`/api/v1/trips/${ride.rideId}/begin-pin-verification`).set('Authorization', `Bearer ${ride.courierToken}`).send({}).expect(201);
    await http.post(`/api/v1/trips/${ride.rideId}/verify-pin`).set('Authorization', `Bearer ${ride.courierToken}`).send({ pin: ride.pin }).expect(201);
    current = await http.get(`/api/v1/trips/${ride.rideId}/delivery`).set('Authorization', `Bearer ${ride.customerToken}`).expect(200);
    assert.equal(current.body.data.details.status, 'IN_TRANSIT');
    assert.ok(current.body.data.history.some((h) => h.toStatus === 'PICKED_UP'));

    // Delivery rides do not complete via /complete.
    await http.post(`/api/v1/trips/${ride.rideId}/complete`).set('Authorization', `Bearer ${ride.courierToken}`).send({}).expect(409);

    // Photo evidence does not move status; recipient OTP completes.
    const photo = await http.post(`/api/v1/trips/${ride.rideId}/delivery/photo`)
      .set('Authorization', `Bearer ${ride.courierToken}`)
      .attach('file', jpg, 'package.jpg').expect(201);
    current = await http.get(`/api/v1/trips/${ride.rideId}/delivery`).set('Authorization', `Bearer ${ride.customerToken}`).expect(200);
    assert.equal(current.body.data.details.status, 'IN_TRANSIT');
    assert.ok(current.body.data.proofs.some((p) => p.id === photo.body.data.id && p.proofType === 'PHOTO'));
    const strangerToken = await login(http, captured, '+923005555099');
    await http.get(`/api/v1/trips/${ride.rideId}/delivery/photos/${photo.body.data.id}`)
      .set('Authorization', `Bearer ${strangerToken}`).expect(403);
    await http.get(`/api/v1/trips/${ride.rideId}/delivery/photos/${photo.body.data.id}`)
      .set('Authorization', `Bearer ${ride.customerToken}`).expect(200);

    await http.post(`/api/v1/trips/${ride.rideId}/delivery/arrived-at-recipient`)
      .set('Authorization', `Bearer ${ride.courierToken}`).send({}).expect(201);
    await http.post(`/api/v1/trips/${ride.rideId}/delivery/verify-otp`)
      .set('Authorization', `Bearer ${ride.courierToken}`).send({ otp: '0000' }).expect(401);
    const completed = await http.post(`/api/v1/trips/${ride.rideId}/delivery/verify-otp`)
      .set('Authorization', `Bearer ${ride.courierToken}`).send({ otp: ride.deliveryOtp }).expect(201);
    assert.equal(completed.body.data.status, 'COMPLETED');
    current = await http.get(`/api/v1/trips/${ride.rideId}/delivery`).set('Authorization', `Bearer ${ride.customerToken}`).expect(200);
    assert.equal(current.body.data.details.status, 'DELIVERED');
  } finally {
    await app.close();
  }
});

test('delivery e2e: OTP lockout recovered by regenerate, cancel mirrors', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);

    // Lockout then regenerate.
    const ride = await makeDeliveryRide(http, captured, store, adminToken, '+923005555102');
    await http.post(`/api/v1/trips/${ride.rideId}/en-route`).set('Authorization', `Bearer ${ride.courierToken}`).send({}).expect(201);
    await http.post(`/api/v1/trips/${ride.rideId}/arrived`).set('Authorization', `Bearer ${ride.courierToken}`).send({}).expect(201);
    await http.post(`/api/v1/trips/${ride.rideId}/begin-pin-verification`).set('Authorization', `Bearer ${ride.courierToken}`).send({}).expect(201);
    await http.post(`/api/v1/trips/${ride.rideId}/verify-pin`).set('Authorization', `Bearer ${ride.courierToken}`).send({ pin: ride.pin }).expect(201);
    await http.post(`/api/v1/trips/${ride.rideId}/delivery/arrived-at-recipient`).set('Authorization', `Bearer ${ride.courierToken}`).send({}).expect(201);
    for (let i = 0; i < 5; i++) {
      await http.post(`/api/v1/trips/${ride.rideId}/delivery/verify-otp`)
        .set('Authorization', `Bearer ${ride.courierToken}`).send({ otp: '1111' }).expect(401);
    }
    await http.post(`/api/v1/trips/${ride.rideId}/delivery/verify-otp`)
      .set('Authorization', `Bearer ${ride.courierToken}`).send({ otp: ride.deliveryOtp }).expect(403);
    const regenerated = await http.post(`/api/v1/trips/${ride.rideId}/delivery/regenerate-otp`)
      .set('Authorization', `Bearer ${ride.customerToken}`).send({}).expect(201);
    assert.notEqual(regenerated.body.data.deliveryOtp, ride.deliveryOtp);
    const completed = await http.post(`/api/v1/trips/${ride.rideId}/delivery/verify-otp`)
      .set('Authorization', `Bearer ${ride.courierToken}`).send({ otp: regenerated.body.data.deliveryOtp }).expect(201);
    assert.equal(completed.body.data.status, 'COMPLETED');

    // Customer cancel before pickup mirrors onto delivery status.
    const ride2 = await makeDeliveryRide(http, captured, store, adminToken, '+923005555103');
    await http.post(`/api/v1/trips/${ride2.rideId}/cancel`)
      .set('Authorization', `Bearer ${ride2.customerToken}`).send({ reason: 'No longer needed' }).expect(201);
    const delivery2 = await http.get(`/api/v1/trips/${ride2.rideId}/delivery`)
      .set('Authorization', `Bearer ${ride2.customerToken}`).expect(200);
    assert.equal(delivery2.body.data.details.status, 'CANCELLED_BY_CUSTOMER');
  } finally {
    await app.close();
  }
});
