import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import request from 'supertest';
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
  return { token: verified.body.data.accessToken, userId: verified.body.data.user.id };
}

test('drivers active-trip: returns the live ride, ignores finished ones, isolates drivers', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const driver = await loginAsDriver(http, captured, '+923001111111');
    const other = await loginAsDriver(http, captured, '+923002222222');

    // No trip yet.
    const empty = await http.get('/api/v1/drivers/active-trip')
      .set('Authorization', `Bearer ${driver.token}`).expect(200);
    assert.equal(empty.body.data, null);

    // Another driver's ride must never leak.
    await store.createRide({
      requestId: 'req-other', customerId: 'cust-9', driverId: other.userId,
      vehicleId: null, status: 'DRIVER_SELECTED', finalFareMinor: 25000,
      commissionMinor: null, commissionRuleVersion: null, paymentMethod: 'CASH',
    });
    const isolated = await http.get('/api/v1/drivers/active-trip')
      .set('Authorization', `Bearer ${driver.token}`).expect(200);
    assert.equal(isolated.body.data, null);

    // The driver's own live ride is returned, even with a newer
    // completed ride present (completed rides are not active).
    const live = await store.createRide({
      requestId: 'req-1', customerId: 'cust-1', driverId: driver.userId,
      vehicleId: null, status: 'DRIVER_SELECTED', finalFareMinor: 30000,
      commissionMinor: null, commissionRuleVersion: null, paymentMethod: 'CASH',
    });
    await store.createRide({
      requestId: 'req-2', customerId: 'cust-2', driverId: driver.userId,
      vehicleId: null, status: 'COMPLETED', finalFareMinor: 20000,
      commissionMinor: null, commissionRuleVersion: null, paymentMethod: 'CASH',
    });
    const found = await http.get('/api/v1/drivers/active-trip')
      .set('Authorization', `Bearer ${driver.token}`).expect(200);
    assert.equal(found.body.data.id, live.id);
    assert.equal(found.body.data.status, 'DRIVER_SELECTED');

    // Once the live ride completes, there is no active trip again.
    await store.setRideStatus(live.id, 'COMPLETED');
    const done = await http.get('/api/v1/drivers/active-trip')
      .set('Authorization', `Bearer ${driver.token}`).expect(200);
    assert.equal(done.body.data, null);
  } finally {
    await app.close();
  }
});
