import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { AppModule } from '../../dist/app.module.js';
import { STORE } from '../../dist/data/store.interface.js';
import { InMemoryStore } from '../../dist/data/in-memory.store.js';
import { SMS_PROVIDER } from '../../dist/auth/sms.provider.js';

const PHONE = '+923001234567';

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

test('auth e2e: OTP flow, refresh rotation, RBAC deny/allow, MFA', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    // Invalid phone format is rejected, not silently accepted.
    await http.post('/api/v1/auth/request-otp').send({ phone: '03001234567' }).expect(400);

    // OTP request + verify
    const req = await http.post('/api/v1/auth/request-otp').send({ phone: PHONE }).expect(201);
    assert.equal(req.body.data.sent, true);
    const code = captured.get(PHONE);
    assert.match(code, /^\d{6}$/);
    await http.post('/api/v1/auth/verify-otp').send({ phone: PHONE, code: '000000' }).expect(401);
    const verified = await http.post('/api/v1/auth/verify-otp').send({ phone: PHONE, code }).expect(201);
    const access = verified.body.data.accessToken;
    const refresh = verified.body.data.refreshToken;
    assert.ok(access && refresh);

    // /users/me
    await http.get('/api/v1/users/me').expect(401);
    const me = await http.get('/api/v1/users/me').set('Authorization', `Bearer ${access}`).expect(200);
    assert.equal(me.body.data.phone, PHONE);
    await http.patch('/api/v1/users/me').set('Authorization', `Bearer ${access}`)
      .send({ firstName: 'Test', lastName: 'User' }).expect(200);

    // Refresh rotation: new token works, old token is revoked.
    const rotated = await http.post('/api/v1/auth/refresh').send({ refreshToken: refresh }).expect(201);
    assert.ok(rotated.body.data.accessToken);
    assert.notEqual(rotated.body.data.refreshToken, refresh);
    await http.post('/api/v1/auth/refresh').send({ refreshToken: refresh }).expect(401);

    // RBAC: customer cannot list roles.
    await http.get('/api/v1/admin/roles').set('Authorization', `Bearer ${access}`).expect(403);

    // Admin: create + SUPER_ADMIN, login, list roles.
    const passwordHash = await bcrypt.hash('AdminPass123!', 10);
    const admin = await store.createAdminUser('admin@rahi.test', passwordHash, 'Admin', 'User');
    const superRole = await store.createRole('SUPER_ADMIN');
    await store.assignRoleToUser(admin.id, superRole.id);
    const login = await http.post('/api/v1/auth/admin/login')
      .send({ email: 'admin@rahi.test', password: 'AdminPass123!' }).expect(201);
    const adminAccess = login.body.data.accessToken;
    assert.ok(adminAccess);
    await http.post('/api/v1/auth/admin/login')
      .send({ email: 'admin@rahi.test', password: 'wrong-password' }).expect(401);
    const roles = await http.get('/api/v1/admin/roles')
      .set('Authorization', `Bearer ${adminAccess}`).expect(200);
    assert.ok(Array.isArray(roles.body.data));

    // MFA: setup -> enable -> login requires MFA -> verify succeeds.
    const setup = await http.post('/api/v1/auth/mfa/setup')
      .set('Authorization', `Bearer ${adminAccess}`).expect(201);
    const mfaCode = authenticator.generate(setup.body.data.secret);
    await http.post('/api/v1/auth/mfa/enable')
      .set('Authorization', `Bearer ${adminAccess}`).send({ code: mfaCode }).expect(201);
    const login2 = await http.post('/api/v1/auth/admin/login')
      .send({ email: 'admin@rahi.test', password: 'AdminPass123!' }).expect(201);
    assert.equal(login2.body.data.mfaRequired, true);
    const mfaCode2 = authenticator.generate(setup.body.data.secret);
    const mfaOk = await http.post('/api/v1/auth/admin/mfa-verify')
      .send({ mfaToken: login2.body.data.mfaToken, code: mfaCode2 }).expect(201);
    assert.ok(mfaOk.body.data.accessToken);
  } finally {
    await app.close();
  }
});
