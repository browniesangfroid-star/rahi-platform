import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { io } from 'socket.io-client';
import { AppModule } from '../../dist/app.module.js';
import { STORE } from '../../dist/data/store.interface.js';
import { InMemoryStore } from '../../dist/data/in-memory.store.js';
import { SMS_PROVIDER } from '../../dist/auth/sms.provider.js';
import { OsrmRoutingProvider } from '../../dist/tracking/osrm-routing.provider.js';
import { HaversineRoutingProvider } from '../../dist/tracking/haversine-routing.provider.js';

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
  const admin = await store.createAdminUser('tracking-admin@rahi.test', passwordHash, 'Tracking', 'Admin');
  const superRole = await store.createRole('SUPER_ADMIN');
  await store.assignRoleToUser(admin.id, superRole.id);
  const login = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'tracking-admin@rahi.test', password: 'AdminPass123!' }).expect(201);
  return login.body.data.accessToken;
}

async function makeMatchedRide(http, captured, store, adminToken) {
  const customerToken = await login(http, captured, '+923007777001');
  const driverToken = await login(http, captured, '+923007777101');
  await http.post('/api/v1/drivers/register').set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
  for (const type of ['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION']) {
    await http.post('/api/v1/drivers/documents').set('Authorization', `Bearer ${driverToken}`)
      .field('documentType', type).attach('file', jpg, `${type.toLowerCase()}.jpg`).expect(201);
  }
  const vehicle = await http.post('/api/v1/drivers/vehicles').set('Authorization', `Bearer ${driverToken}`)
    .send({ categoryCode: 'CAR_ECONOMY', make: 'Suzuki', model: 'Alto', year: 2022, color: 'White', registrationNumber: 'LEA-22-7777' }).expect(201);
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
  return { customerToken, driverToken, rideId: accepted.body.data.ride.id, requestId: req.body.data.id };
}

test('tracking e2e: REST location flow, permissions, route', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const { customerToken, driverToken, rideId } = await makeMatchedRide(http, captured, store, adminToken);
    const strangerToken = await login(http, captured, '+923007777002');

    // Only the assigned driver writes; everyone else is refused.
    await http.post(`/api/v1/rides/${rideId}/location`).set('Authorization', `Bearer ${customerToken}`)
      .send({ lat: 31.5254, lng: 74.3587 }).expect(403);
    const update = await http.post(`/api/v1/rides/${rideId}/location`).set('Authorization', `Bearer ${driverToken}`)
      .send({ lat: 31.5254, lng: 74.3587 }).expect(201);
    assert.equal(update.body.data.rideId, rideId);
    assert.equal(update.body.data.etaTarget, 'pickup');
    assert.equal(update.body.data.routeProvider, 'haversine');
    assert.ok(update.body.data.etaMin >= 0);
    assert.ok(update.body.data.routePoints.length >= 2);

    // Customer and admin read; strangers do not.
    const latest = await http.get(`/api/v1/rides/${rideId}/location`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(latest.body.data.location.lat, 31.5254);
    await http.get(`/api/v1/rides/${rideId}/location`).set('Authorization', `Bearer ${strangerToken}`).expect(403);
    const route = await http.get(`/api/v1/rides/${rideId}/route`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(route.body.data.status, 'DRIVER_SELECTED');
    assert.deepEqual(route.body.data.pickup, PICKUP);
    assert.deepEqual(route.body.data.destination, DEST);

    // Invalid coordinates are rejected, not stored.
    await http.post(`/api/v1/rides/${rideId}/location`).set('Authorization', `Bearer ${driverToken}`)
      .send({ lat: 100, lng: 74 }).expect(400);
    const locations = await store.listRideLocations(rideId, 10);
    assert.equal(locations.length, 1);
  } finally {
    await app.close();
  }
});

test('tracking e2e: Socket.IO join, driver location broadcast, unauthenticated disconnect', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  let customerSocket;
  let driverSocket;
  let unauthSocket;
  try {
    const adminToken = await loginAsAdmin(http, store);
    const { customerToken, driverToken, rideId } = await makeMatchedRide(http, captured, store, adminToken);
    await app.listen(0);
    const port = app.getHttpServer().address().port;
    const url = `http://127.0.0.1:${port}`;

    const connectSocket = (token) => new Promise((resolve, reject) => {
      const socket = io(url, { auth: token ? { token } : {}, reconnection: false, transports: ['websocket'] });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('socket connect timeout')), 5000);
    });

    customerSocket = await connectSocket(customerToken);
    driverSocket = await connectSocket(driverToken);

    const joined = await new Promise((resolve) => {
      customerSocket.emit('joinRide', { rideId }, resolve);
    });
    assert.equal(joined.joined, true);
    await new Promise((resolve) => {
      driverSocket.emit('joinRide', { rideId }, resolve);
    });

    const received = await new Promise((resolve, reject) => {
      customerSocket.on('locationUpdate', resolve);
      driverSocket.emit('driverLocation', { rideId, lat: 31.526, lng: 74.359 }, (ack) => {
        if (ack?.rideId !== rideId) reject(new Error('driverLocation ack missing rideId'));
      });
      setTimeout(() => reject(new Error('locationUpdate not received')), 5000);
    });
    assert.equal(received.lat, 31.526);
    assert.equal(received.etaTarget, 'pickup');

    // No token -> disconnected on connect.
    unauthSocket = io(url, { reconnection: false, transports: ['websocket'] });
    await new Promise((resolve) => {
      unauthSocket.on('disconnect', resolve);
      setTimeout(resolve, 5000);
    });
    assert.equal(unauthSocket.connected, false);
  } finally {
    customerSocket?.disconnect();
    driverSocket?.disconnect();
    unauthSocket?.disconnect();
    await app.close();
  }
});

test('routing: OSRM failure falls back to haversine and says so', async () => {
  const osrm = new OsrmRoutingProvider('http://127.0.0.1:9');
  const haversine = new HaversineRoutingProvider();
  const from = { lat: 31.5204, lng: 74.3587 };
  const to = { lat: 31.5497, lng: 74.3436 };
  const fallback = await osrm.route(from, to);
  const direct = await haversine.route(from, to);
  assert.equal(fallback.provider, 'osrm-fallback-haversine');
  assert.equal(fallback.distanceKm, direct.distanceKm);
});
