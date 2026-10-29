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
const DETAILS = {
  senderName: 'Ali', senderPhone: '+923001111111',
  recipientName: 'Sara', recipientPhone: '+923002222222',
  packageCategory: 'PARCEL', sizeWeight: '2 kg', notes: '',
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
  return { app, store, captured };
}

async function loginAsAdmin(http, store) {
  const passwordHash = await bcrypt.hash('AdminPass123!', 10);
  const admin = await store.createAdminUser('admin13@rahi.test', passwordHash, 'Admin', 'Thirteen');
  const superRole = await store.createRole('SUPER_ADMIN');
  await store.assignRoleToUser(admin.id, superRole.id);
  const login = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'admin13@rahi.test', password: 'AdminPass123!' }).expect(201);
  return login.body.data.accessToken;
}

async function loginAsUser(http, captured, phone) {
  await http.post('/api/v1/auth/request-otp').send({ phone }).expect(201);
  const verified = await http.post('/api/v1/auth/verify-otp')
    .send({ phone, code: captured.get(phone) }).expect(201);
  return verified.body.data.accessToken;
}

test('admin e2e: cities, pricing versioning, deactivation removes city from estimates', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const userToken = await loginAsUser(http, captured, '+923007777001');

    // A plain user cannot touch admin endpoints.
    await http.post('/api/v1/admin/cities').set('Authorization', `Bearer ${userToken}`)
      .send({ name: 'Lahore', countryCode: 'PK', currency: 'PKR', timezone: 'Asia/Karachi', centreLat: 31.5204, centreLng: 74.3587 })
      .expect(403);

    const city = await http.post('/api/v1/admin/cities').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Lahore', countryCode: 'PK', currency: 'PKR', timezone: 'Asia/Karachi', centreLat: 31.5204, centreLng: 74.3587 })
      .expect(201);
    const cityId = city.body.data.id;
    assert.equal(city.body.data.isActive, true);

    const ruleBody = {
      cityId, serviceCode: 'CAR', mode: 'NEGOTIATION',
      baseFareMinor: 15000, perKmMinor: 5000, perMinMinor: 500,
      minimumFareMinor: 20000, bookingFeeMinor: 2000, demandCap: 2.0,
    };
    const rule1 = await http.post('/api/v1/admin/pricing-rules').set('Authorization', `Bearer ${adminToken}`)
      .send(ruleBody).expect(201);
    assert.equal(rule1.body.data.version, 1);
    const rule2 = await http.post('/api/v1/admin/pricing-rules').set('Authorization', `Bearer ${adminToken}`)
      .send({ ...ruleBody, baseFareMinor: 18000 }).expect(201);
    assert.equal(rule2.body.data.version, 2);
    // Estimates use the latest version's base fare (18000 > old 15000).
    const estimate = await http.post('/api/v1/rides/estimate').set('Authorization', `Bearer ${userToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY' }).expect(201);
    assert.ok(estimate.body.data.suggestedFareMinor >= 18000);

    // Deactivating the city removes it from service entirely.
    await http.patch(`/api/v1/admin/cities/${cityId}/active`).set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: false }).expect(200);
    await http.post('/api/v1/rides/estimate').set('Authorization', `Bearer ${userToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY' }).expect(400);
    await http.patch(`/api/v1/admin/cities/${cityId}/active`).set('Authorization', `Bearer ${adminToken}`)
      .send({ isActive: true }).expect(200);
    await http.post('/api/v1/rides/estimate').set('Authorization', `Bearer ${userToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY' }).expect(201);

    // Audit recorded the mutations, newest first.
    const audit = await http.get('/api/v1/admin/audit-logs').set('Authorization', `Bearer ${adminToken}`).expect(200);
    const actions = audit.body.data.map((a) => a.action);
    assert.ok(actions.includes('CITY_CREATED'));
    assert.ok(actions.includes('PRICING_RULE_CREATED'));
    assert.ok(actions.includes('CITY_DEACTIVATED'));
  } finally {
    await app.close();
  }
});

test('admin e2e: catalog deactivation blocks estimates; package categories are admin-managed', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    const userToken = await loginAsUser(http, captured, '+923007777002');
    const city = await http.post('/api/v1/admin/cities').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Lahore', countryCode: 'PK', currency: 'PKR', timezone: 'Asia/Karachi', centreLat: 31.5204, centreLng: 74.3587 })
      .expect(201);
    await http.post('/api/v1/admin/pricing-rules').set('Authorization', `Bearer ${adminToken}`)
      .send({
        cityId: city.body.data.id, serviceCode: 'DELIVERY', mode: 'HYBRID',
        baseFareMinor: 12000, perKmMinor: 4000, perMinMinor: 400,
        minimumFareMinor: 15000, bookingFeeMinor: 1500, demandCap: 1.5,
      }).expect(201);

    // Default catalogues are served before any admin change.
    const services = await http.get('/api/v1/admin/catalog/services').set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.ok(services.body.data.some((s) => s.code === 'DELIVERY' && s.isActive));

    // Deactivating DELIVERY blocks delivery estimates.
    await http.patch('/api/v1/admin/catalog/services/DELIVERY').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Delivery', isActive: false }).expect(200);
    await http.post('/api/v1/rides/estimate').set('Authorization', `Bearer ${userToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'DELIVERY' }).expect(400);
    await http.patch('/api/v1/admin/catalog/services/DELIVERY').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Delivery', isActive: true }).expect(200);

    // Package categories: replace the list — a brand-new category is
    // accepted and a removed default is rejected.
    await http.post('/api/v1/admin/catalog/package-categories').set('Authorization', `Bearer ${adminToken}`)
      .send({ categories: ['MEDICINE', 'PARCEL'] }).expect(201);
    await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${userToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'DELIVERY', paymentMethod: 'CASH', deliveryDetails: { ...DETAILS, packageCategory: 'MEDICINE' } })
      .expect(201);
    await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${userToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'DELIVERY', paymentMethod: 'CASH', deliveryDetails: { ...DETAILS, packageCategory: 'FRAGILE' } })
      .expect(400);

    // Service-category mapping: removing BIKE from DELIVERY blocks
    // bike-category delivery estimates.
    await http.post('/api/v1/admin/catalog/service-categories').set('Authorization', `Bearer ${adminToken}`)
      .send({ mapping: { CAR: ['CAR_ECONOMY'], BIKE: ['BIKE'], DELIVERY: ['CAR_ECONOMY'] } }).expect(201);
    const mapping = await http.get('/api/v1/admin/catalog/service-categories').set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.deepEqual(mapping.body.data.DELIVERY, ['CAR_ECONOMY']);
  } finally {
    await app.close();
  }
});

test('admin e2e: overview reflects real counts', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    await loginAsUser(http, captured, '+923007777003');
    await http.post('/api/v1/admin/cities').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Lahore', countryCode: 'PK', currency: 'PKR', timezone: 'Asia/Karachi', centreLat: 31.5204, centreLng: 74.3587 })
      .expect(201);
    const overview = await http.get('/api/v1/admin/overview').set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(overview.body.data.citiesTotal, 1);
    assert.equal(overview.body.data.activeCities, 1);
    assert.ok(overview.body.data.usersTotal >= 2);
    assert.equal(overview.body.data.commissionBalanceMinor, 0);
    assert.equal(overview.body.data.pendingTopups, 0);
  } finally {
    await app.close();
  }
});
