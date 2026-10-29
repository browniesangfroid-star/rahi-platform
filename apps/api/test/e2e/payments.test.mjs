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
  return { app, store, captured, city };
}

async function login(http, captured, phone) {
  await http.post('/api/v1/auth/request-otp').send({ phone }).expect(201);
  const verified = await http.post('/api/v1/auth/verify-otp')
    .send({ phone, code: captured.get(phone) }).expect(201);
  return verified.body.data.accessToken;
}

async function loginAsAdmin(http, store) {
  const passwordHash = await bcrypt.hash('AdminPass123!', 10);
  const admin = await store.createAdminUser('pay-admin@rahi.test', passwordHash, 'Pay', 'Admin');
  const superRole = await store.createRole('SUPER_ADMIN');
  await store.assignRoleToUser(admin.id, superRole.id);
  const login = await http.post('/api/v1/auth/admin/login')
    .send({ email: 'pay-admin@rahi.test', password: 'AdminPass123!' }).expect(201);
  return login.body.data.accessToken;
}

let courierCounter = 0;
async function makeApprovedDriver(http, captured, adminToken) {
  courierCounter += 1;
  const suffix = String(800000 + courierCounter);
  const token = await login(http, captured, `+92300${suffix}`);
  await http.post('/api/v1/drivers/register').set('Authorization', `Bearer ${token}`).send({}).expect(201);
  for (const type of ['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION']) {
    await http.post('/api/v1/drivers/documents').set('Authorization', `Bearer ${token}`)
      .field('documentType', type).attach('file', jpg, `${type.toLowerCase()}.jpg`).expect(201);
  }
  const vehicle = await http.post('/api/v1/drivers/vehicles').set('Authorization', `Bearer ${token}`)
    .send({ categoryCode: 'CAR_ECONOMY', make: 'Toyota', model: 'Corolla', year: 2021, color: 'White', registrationNumber: `LEA-${suffix}` }).expect(201);
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

async function topupAndApprove(http, customerToken, adminToken, amountMinor, ownerType = 'CUSTOMER') {
  const topup = await http.post('/api/v1/wallet/topups').set('Authorization', `Bearer ${customerToken}`)
    .send({ ownerType, amountMinor, reference: 'bank-txn-1' }).expect(201);
  await http.post(`/api/v1/admin/wallet/topups/${topup.body.data.id}/approve`)
    .set('Authorization', `Bearer ${adminToken}`).send({}).expect(201);
  return topup.body.data.id;
}

async function makeCompletedRide(http, captured, adminToken, customerPhone, driver, paymentMethod, fareMinor) {
  const customerToken = await login(http, captured, customerPhone);
  const req = await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${customerToken}`)
    .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', paymentMethod }).expect(201);
  const offer = await http.post(`/api/v1/rides/${req.body.data.id}/offers`).set('Authorization', `Bearer ${driver.token}`)
    .send({ fareMinor }).expect(201);
  const accepted = await http.post(`/api/v1/rides/${req.body.data.id}/offers/${offer.body.data.id}/accept`)
    .set('Authorization', `Bearer ${customerToken}`).send({}).expect(201);
  const rideId = accepted.body.data.ride.id;
  const pin = accepted.body.data.pin;
  await http.post(`/api/v1/trips/${rideId}/en-route`).set('Authorization', `Bearer ${driver.token}`).send({}).expect(201);
  await http.post(`/api/v1/trips/${rideId}/arrived`).set('Authorization', `Bearer ${driver.token}`).send({}).expect(201);
  await http.post(`/api/v1/trips/${rideId}/begin-pin-verification`).set('Authorization', `Bearer ${driver.token}`).send({}).expect(201);
  await http.post(`/api/v1/trips/${rideId}/verify-pin`).set('Authorization', `Bearer ${driver.token}`).send({ pin }).expect(201);
  const completed = await http.post(`/api/v1/trips/${rideId}/complete`).set('Authorization', `Bearer ${driver.token}`).send({}).expect(201);
  return { customerToken, rideId, completed: completed.body.data };
}

test('payments e2e: wallet settlement with 15% commission on fare excluding booking fee', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    await http.post('/api/v1/admin/commission-rules').set('Authorization', `Bearer ${adminToken}`)
      .send({ scope: 'GLOBAL', ratePercent: 15 }).expect(201);

    const driver = await makeApprovedDriver(http, captured, adminToken);
    const customerToken = await login(http, captured, '+923006666001');
    await topupAndApprove(http, customerToken, adminToken, 100000);

    const { rideId } = await makeCompletedRide(http, captured, adminToken, '+923006666001', driver, 'WALLET', 30000);
    // Fare 30000, booking fee 2000, commission base 28000, 15% = 4200.
    const settlement = await http.get(`/api/v1/payments/rides/${rideId}`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(settlement.body.data.payment.status, 'PAID');
    assert.equal(settlement.body.data.commissionMinor, 4200);
    assert.equal(settlement.body.data.driverEarningsMinor, 25800);

    const customerWallet = await http.get('/api/v1/wallet/me').set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(customerWallet.body.data.balanceMinor, 70000);
    const driverWallet = await http.get('/api/v1/wallet/me?role=DRIVER').set('Authorization', `Bearer ${driver.token}`).expect(200);
    assert.equal(driverWallet.body.data.balanceMinor, 25800);
    assert.equal(await store.getBalance('COMMISSION', null), 4200);

    // Re-settling is a no-op, not a second payment.
    const again = await http.post(`/api/v1/payments/rides/${rideId}/settle`).set('Authorization', `Bearer ${customerToken}`).send({}).expect(201);
    assert.equal(again.body.data.settled, false);
    const after = await http.get('/api/v1/wallet/me').set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(after.body.data.balanceMinor, 70000);
  } finally {
    await app.close();
  }
});

test('payments e2e: insufficient wallet fails settlement, then retry after top-up succeeds', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    await http.post('/api/v1/admin/commission-rules').set('Authorization', `Bearer ${adminToken}`)
      .send({ scope: 'GLOBAL', ratePercent: 15 }).expect(201);
    const driver = await makeApprovedDriver(http, captured, adminToken);
    const { rideId, completed } = await makeCompletedRide(http, captured, adminToken, '+923006666101', driver, 'WALLET', 30000);
    // Trip stays completed even though the wallet was empty.
    assert.equal(completed.status, 'COMPLETED');
    const settlement = await http.get(`/api/v1/payments/rides/${rideId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(settlement.body.data.payment.status, 'FAILED');

    const customerToken = await login(http, captured, '+923006666101');
    await topupAndApprove(http, customerToken, adminToken, 100000);
    const retried = await http.post(`/api/v1/payments/rides/${rideId}/settle`).set('Authorization', `Bearer ${customerToken}`).send({}).expect(201);
    assert.equal(retried.body.data.settled, true);
    const after = await http.get(`/api/v1/payments/rides/${rideId}`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(after.body.data.payment.status, 'PAID');
    assert.equal(after.body.data.commissionMinor, 4200);
  } finally {
    await app.close();
  }
});

test('payments e2e: cash ride records commission debt; driver override beats global', async () => {
  const { app, store, captured, city } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    await http.post('/api/v1/admin/commission-rules').set('Authorization', `Bearer ${adminToken}`)
      .send({ scope: 'GLOBAL', ratePercent: 15 }).expect(201);
    const driver = await makeApprovedDriver(http, captured, adminToken);
    await http.post('/api/v1/admin/commission-rules').set('Authorization', `Bearer ${adminToken}`)
      .send({ scope: 'DRIVER', driverUserId: driver.driverId, ratePercent: 10 }).expect(201);

    const { rideId } = await makeCompletedRide(http, captured, adminToken, '+923006666201', driver, 'CASH', 30000);
    // Commission base 28000 at 10% override = 2800, as driver debt.
    const settlement = await http.get(`/api/v1/payments/rides/${rideId}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(settlement.body.data.payment.status, 'PAID');
    assert.equal(settlement.body.data.payment.provider, 'CASH');
    assert.equal(settlement.body.data.commissionMinor, 2800);
    const driverWallet = await http.get('/api/v1/wallet/me?role=DRIVER').set('Authorization', `Bearer ${driver.token}`).expect(200);
    assert.equal(driverWallet.body.data.balanceMinor, -2800);
    assert.equal(await store.getBalance('COMMISSION', null), 2800);

    // A second driver without an override still pays the global rate.
    const driver2 = await makeApprovedDriver(http, captured, adminToken);
    const { rideId: rideId2 } = await makeCompletedRide(http, captured, adminToken, '+923006666202', driver2, 'CASH', 30000);
    const settlement2 = await http.get(`/api/v1/payments/rides/${rideId2}`).set('Authorization', `Bearer ${adminToken}`).expect(200);
    assert.equal(settlement2.body.data.commissionMinor, 4200);
  } finally {
    await app.close();
  }
});

test('payments e2e: partial then full refund reverses commission proportionally', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    await http.post('/api/v1/admin/commission-rules').set('Authorization', `Bearer ${adminToken}`)
      .send({ scope: 'GLOBAL', ratePercent: 15 }).expect(201);
    const driver = await makeApprovedDriver(http, captured, adminToken);
    const customerToken = await login(http, captured, '+923006666301');
    await topupAndApprove(http, customerToken, adminToken, 100000);
    const { rideId } = await makeCompletedRide(http, captured, adminToken, '+923006666301', driver, 'WALLET', 30000);
    const settlement = await http.get(`/api/v1/payments/rides/${rideId}`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    const paymentId = settlement.body.data.payment.id;

    // Partial refund of 10000: commission share = 4200 * 10000 / 30000 = 1400.
    await http.post(`/api/v1/admin/payments/${paymentId}/refund`).set('Authorization', `Bearer ${adminToken}`)
      .send({ amountMinor: 10000, reason: 'Driver took a wrong turn' }).expect(201);
    let after = await http.get(`/api/v1/payments/rides/${rideId}`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(after.body.data.payment.status, 'PARTIALLY_REFUNDED');
    assert.equal(after.body.data.refundedMinor, 10000);
    let customerWallet = await http.get('/api/v1/wallet/me').set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(customerWallet.body.data.balanceMinor, 80000);
    let driverWallet = await http.get('/api/v1/wallet/me?role=DRIVER').set('Authorization', `Bearer ${driver.token}`).expect(200);
    assert.equal(driverWallet.body.data.balanceMinor, 25800 - 8600);
    assert.equal(await store.getBalance('COMMISSION', null), 4200 - 1400);

    // Remaining 20000 fully refunds the rest (commission share 2800).
    await http.post(`/api/v1/admin/payments/${paymentId}/refund`).set('Authorization', `Bearer ${adminToken}`)
      .send({ amountMinor: 20000, reason: 'Full refund approved' }).expect(201);
    after = await http.get(`/api/v1/payments/rides/${rideId}`).set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(after.body.data.payment.status, 'REFUNDED');
    customerWallet = await http.get('/api/v1/wallet/me').set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(customerWallet.body.data.balanceMinor, 100000);
    assert.equal(await store.getBalance('COMMISSION', null), 0);

    // Refunding beyond the payment is refused.
    await http.post(`/api/v1/admin/payments/${paymentId}/refund`).set('Authorization', `Bearer ${adminToken}`)
      .send({ amountMinor: 1, reason: 'Too late' }).expect(409);
  } finally {
    await app.close();
  }
});

test('payments e2e: cancellation fee charged on matched cancel, not on admin cancel; withdrawal approval', async () => {
  const { app, store, captured } = await buildApp();
  const http = request(app.getHttpServer());
  try {
    const adminToken = await loginAsAdmin(http, store);
    await http.post('/api/v1/admin/commission-rules').set('Authorization', `Bearer ${adminToken}`)
      .send({ scope: 'GLOBAL', ratePercent: 15 }).expect(201);
    await http.post('/api/v1/admin/settings/cancellation-fee').set('Authorization', `Bearer ${adminToken}`)
      .send({ amountMinor: 5000 }).expect(201);

    const driver = await makeApprovedDriver(http, captured, adminToken);
    const customerToken = await login(http, captured, '+923006666401');
    const req = await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${customerToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', paymentMethod: 'CASH' }).expect(201);
    const offer = await http.post(`/api/v1/rides/${req.body.data.id}/offers`).set('Authorization', `Bearer ${driver.token}`)
      .send({ fareMinor: 30000 }).expect(201);
    const accepted = await http.post(`/api/v1/rides/${req.body.data.id}/offers/${offer.body.data.id}/accept`)
      .set('Authorization', `Bearer ${customerToken}`).send({}).expect(201);
    await http.post(`/api/v1/trips/${accepted.body.data.ride.id}/cancel`)
      .set('Authorization', `Bearer ${customerToken}`).send({ reason: 'Changed my mind' }).expect(201);
    const customerWallet = await http.get('/api/v1/wallet/me').set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(customerWallet.body.data.balanceMinor, -5000);
    assert.equal(await store.getBalance('COMMISSION', null), 5000);

    // Admin cancel of a second matched ride charges nothing.
    const req2 = await http.post('/api/v1/rides/request').set('Authorization', `Bearer ${customerToken}`)
      .send({ pickup: PICKUP, destination: DEST, service: 'CAR', category: 'CAR_ECONOMY', paymentMethod: 'CASH' }).expect(201);
    const offer2 = await http.post(`/api/v1/rides/${req2.body.data.id}/offers`).set('Authorization', `Bearer ${driver.token}`)
      .send({ fareMinor: 30000 }).expect(201);
    const accepted2 = await http.post(`/api/v1/rides/${req2.body.data.id}/offers/${offer2.body.data.id}/accept`)
      .set('Authorization', `Bearer ${customerToken}`).send({}).expect(201);
    await http.post(`/api/v1/admin/trips/${accepted2.body.data.ride.id}/cancel`)
      .set('Authorization', `Bearer ${adminToken}`).send({ reason: 'Ops decision' }).expect(201);
    const afterAdmin = await http.get('/api/v1/wallet/me').set('Authorization', `Bearer ${customerToken}`).expect(200);
    assert.equal(afterAdmin.body.data.balanceMinor, -5000);

    // Driver withdrawal: driver earns on a wallet ride, then withdraws part of it.
    const driver2 = await makeApprovedDriver(http, captured, adminToken);
    const customer2 = await login(http, captured, '+923006666402');
    await topupAndApprove(http, customer2, adminToken, 100000);
    await makeCompletedRide(http, captured, adminToken, '+923006666402', driver2, 'WALLET', 30000);
    const withdrawal = await http.post('/api/v1/wallet/withdrawals').set('Authorization', `Bearer ${driver2.token}`)
      .send({ ownerType: 'DRIVER', amountMinor: 10000 }).expect(201);
    await http.post(`/api/v1/admin/wallet/withdrawals/${withdrawal.body.data.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`).send({ payoutReference: 'bank-987' }).expect(201);
    const driver2Wallet = await http.get('/api/v1/wallet/me?role=DRIVER').set('Authorization', `Bearer ${driver2.token}`).expect(200);
    assert.equal(driver2Wallet.body.data.balanceMinor, 25800 - 10000);
  } finally {
    await app.close();
  }
});
