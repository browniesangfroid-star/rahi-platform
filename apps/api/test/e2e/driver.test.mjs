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

async function loginAsDriver(http, captured, phone) {
  await http.post('/api/v1/auth/request-otp').send({ phone }).expect(201);
  const verified = await http.post('/api/v1/auth/verify-otp')
    .send({ phone, code: captured.get(phone) }).expect(201);
  return verified.body.data.accessToken;
}

async function loginAsAdmin(http, store) {
  const passwordHash = await bcrypt.hash('AdminPass123!', 10);
  const admin = await store.createAdminUser('kyc-admin@rahi.test', passwordHash, 'Kyc', 'Admin');
  const superRole = await store.createRole('SUPER_ADMIN');
  await store.assignRoleToUser(admin.id, superRole.id);
  const login = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'kyc-admin@rahi.test', password: 'AdminPass123!' }).expect(201);
  return login.body.data.accessToken;
}

const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

test('driver e2e: register, documents, vehicles, KYC approve gate, activation', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const driverToken = await loginAsDriver(http, captured, '+923001111111');
    const adminToken = await loginAsAdmin(http, store);

    // Non-admin cannot approve.
    await http.post('/api/v1/admin/drivers/someone/approve')
      .set('Authorization', `Bearer ${driverToken}`).expect(403);

    // Register + documents + vehicle, then submit.
    const reg = await http.post('/api/v1/drivers/register')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ emergencyContactName: 'Ayesha', emergencyContactPhone: '+923009999999' }).expect(201);
    assert.equal(reg.body.data.profile.kycStatus, 'DRAFT');

    for (const type of ['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION']) {
      const up = await http.post('/api/v1/drivers/documents')
        .set('Authorization', `Bearer ${driverToken}`)
        .field('documentType', type)
        .attach('file', jpg, `${type.toLowerCase()}.jpg`).expect(201);
      assert.equal(up.body.data.documentType, type);
    }
    const vehicle = await http.post('/api/v1/drivers/vehicles')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ categoryCode: 'CAR_ECONOMY', make: 'Suzuki', model: 'Alto', year: 2022, color: 'White', registrationNumber: 'LEA-22-1234' }).expect(201);
    const vehicleId = vehicle.body.data.id;

    // Approve before review is illegal.
    const me = await http.get('/api/v1/users/me').set('Authorization', `Bearer ${driverToken}`).expect(200);
    const driverId = me.body.data.id;
    await http.post(`/api/v1/admin/drivers/${driverId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`).expect(409);

    await http.post('/api/v1/drivers/submit').set('Authorization', `Bearer ${driverToken}`).expect(201);
    await http.post(`/api/v1/admin/drivers/${driverId}/start-review`)
      .set('Authorization', `Bearer ${adminToken}`).expect(201);

    // Queue shows the driver in UNDER_REVIEW.
    const queue = await http.get('/api/v1/admin/kyc?status=UNDER_REVIEW')
      .set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(queue.body.data.length, 1);

    // Vehicle must be approved first, then driver approval + activation = canAcceptRides.
    await http.post(`/api/v1/admin/vehicles/${vehicleId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`).expect(201);
    const approved = await http.post(`/api/v1/admin/drivers/${driverId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`).expect(201);
    assert.equal(approved.body.data.profile.kycStatus, 'APPROVED');
    assert.equal(approved.body.data.canAcceptRides, false); // no active vehicle yet
    await http.post(`/api/v1/drivers/vehicles/${vehicleId}/activate`)
      .set('Authorization', `Bearer ${driverToken}`).expect(201);
    const status = await http.get('/api/v1/drivers/status')
      .set('Authorization', `Bearer ${driverToken}`).expect(200);
    assert.equal(status.body.data.canAcceptRides, true);
    assert.ok(status.body.data.history.length >= 3);
  } finally {
    await app.close();
  }
});

test('driver e2e: reject requires a reason, and document download is owner/admin only', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const driverToken = await loginAsDriver(http, captured, '+923002222222');
    const otherToken = await loginAsDriver(http, captured, '+923003333333');
    const adminToken = await loginAsAdmin(http, store);

    await http.post('/api/v1/drivers/register').set('Authorization', `Bearer ${driverToken}`).send({}).expect(201);
    const up = await http.post('/api/v1/drivers/documents')
      .set('Authorization', `Bearer ${driverToken}`)
      .field('documentType', 'CNIC')
      .attach('file', jpg, 'cnic.jpg').expect(201);
    const docId = up.body.data.id;

    // Other driver cannot download.
    await http.get(`/api/v1/drivers/documents/${docId}/file`)
      .set('Authorization', `Bearer ${otherToken}`).expect(403);
    // Owner can.
    await http.get(`/api/v1/drivers/documents/${docId}/file`)
      .set('Authorization', `Bearer ${driverToken}`).expect(200);
    // Admin can.
    await http.get(`/api/v1/drivers/documents/${docId}/file`)
      .set('Authorization', `Bearer ${adminToken}`).expect(200);

    await http.post('/api/v1/drivers/submit').set('Authorization', `Bearer ${driverToken}`).expect(201);
    const me = await http.get('/api/v1/users/me').set('Authorization', `Bearer ${driverToken}`).expect(200);
    const driverId = me.body.data.id;
    // Reject without reason is a validation error, not a silent rejection.
    await http.post(`/api/v1/admin/drivers/${driverId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`).send({}).expect(400);
    const rejected = await http.post(`/api/v1/admin/drivers/${driverId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: 'CNIC photo is unreadable' }).expect(201);
    assert.equal(rejected.body.data.profile.kycStatus, 'REJECTED');
    assert.equal(rejected.body.data.profile.rejectionReason, 'CNIC photo is unreadable');
  } finally {
    await app.close();
  }
});
