import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { OffersService } from '../../dist/offers/offers.service.js';

function fakeStore(overrides = {}) {
  const request = {
    id: 'req-1', customerId: 'cust-1', status: 'OFFERING', serviceCode: 'CAR',
    paymentMethod: 'CASH', expiresAt: new Date(Date.now() + 60000),
  };
  const offer = { id: 'offer-1', requestId: 'req-1', driverId: 'drv-1', status: 'LIVE', proposedFareMinor: 30000 };
  const store = {
    calls: {},
    async getOffer() { return { ...offer }; },
    async getRideRequest() { return { ...request }; },
    async getDriverProfile() { return { driverUserId: 'drv-1', kycStatus: 'APPROVED' }; },
    async listVehiclesByOwner() {
      return [{ id: 'veh-1', isActive: true, approvalStatus: 'APPROVED' }];
    },
    async getDeliveryRequestDetails() { return null; },
    async acceptOfferAtomic(input) {
      store.calls.tx = input;
      return {
        ride: { id: 'ride-1', requestId: 'req-1', status: 'DRIVER_SELECTED', finalFareMinor: 30000 },
        offer: { ...offer, status: 'ACCEPTED' },
        request: { ...request, status: 'DRIVER_SELECTED' },
      };
    },
    ...overrides,
  };
  return store;
}

test('tx accept: service hands the transaction everything it needs', async () => {
  const store = fakeStore();
  const service = new OffersService(store, {});
  const result = await service.acceptOffer('cust-1', 'offer-1');
  assert.equal(result.ride.id, 'ride-1');
  assert.equal(result.offer.status, 'ACCEPTED');
  assert.match(result.pin, /^\d{4}$/);
  // The PIN plaintext matches the hash handed to the transaction.
  assert.equal(await bcrypt.compare(result.pin, store.calls.tx.pinHash), true);
  assert.equal(store.calls.tx.requestId, 'req-1');
  assert.equal(store.calls.tx.driverId, 'drv-1');
  assert.equal(store.calls.tx.vehicleId, 'veh-1');
  assert.equal(store.calls.tx.finalFareMinor, 30000);
  assert.equal(store.calls.tx.deliveryDetails, null);
  assert.equal(store.calls.tx.deliveryOtpHash, null);
  assert.equal(result.deliveryOtp, null);
});

test('tx accept: delivery rides pass details + OTP hash into the transaction', async () => {
  const details = {
    requestId: 'req-1', senderName: 'A', senderPhone: '0300', recipientName: 'B',
    recipientPhone: '0301', packageCategory: 'DOCUMENTS', sizeWeight: null, notes: null,
  };
  const store = fakeStore({
    async getRideRequest() {
      return { id: 'req-1', customerId: 'cust-1', status: 'OFFERING', serviceCode: 'DELIVERY', paymentMethod: 'CASH', expiresAt: new Date(Date.now() + 60000) };
    },
    async getDeliveryRequestDetails() { return details; },
  });
  const service = new OffersService(store, {});
  const result = await service.acceptOffer('cust-1', 'offer-1');
  assert.deepEqual(store.calls.tx.deliveryDetails, details);
  assert.ok(store.calls.tx.deliveryOtpHash);
  assert.equal(await bcrypt.compare(result.deliveryOtp, store.calls.tx.deliveryOtpHash), true);
});

test('tx accept: store conflict codes become HTTP conflicts, not 500s', async () => {
  const store = fakeStore({
    async acceptOfferAtomic() { throw new Error('OFFER_NOT_LIVE'); },
  });
  const service = new OffersService(store, {});
  await assert.rejects(() => service.acceptOffer('cust-1', 'offer-1'), (e) => e.getStatus() === 409);
});
