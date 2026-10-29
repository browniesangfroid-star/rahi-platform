import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminService } from '../../dist/admin/admin.service.js';

// Regression test for the live Render 500 on catalog updates:
// audit_logs.target_id is a UUID column, but catalog/settings actions
// target codes ('CAR', 'service_categories'). The audit insert threw
// AFTER the change was applied, so the admin saw a 500 for a change
// that had actually gone through. The fix nulls non-UUID targets.
function fakeStore() {
  const captured = [];
  return {
    captured,
    async listServiceTypes() {
      return [
        { code: 'CAR', name: 'Car', isActive: true },
        { code: 'BIKE', name: 'Bike', isActive: true },
        { code: 'DELIVERY', name: 'Delivery', isActive: true },
      ];
    },
    async upsertServiceType(record) { return record; },
    async listCities() { return []; },
    async listPricingRules() { return []; },
    async createPricingRule(rule) {
      return { ...rule, id: '123e4567-e89b-12d3-a456-426614174000' };
    },
    async addAuditLog(entry) { captured.push(entry); return entry; },
  };
}

test('admin audit: a code target (CAR) is stored as null, not thrown', async () => {
  const store = fakeStore();
  const service = new AdminService(store);
  const updated = await service.updateServiceType('admin-1', 'CAR', 'Car', true);
  assert.equal(updated.code, 'CAR');
  assert.equal(store.captured.length, 1);
  assert.equal(store.captured[0].action, 'SERVICE_TYPE_UPDATED');
  assert.equal(store.captured[0].targetId, null);
  assert.match(store.captured[0].afterSummary, /CAR/);
});

test('admin audit: a UUID target (pricing rule id) is preserved', async () => {
  const store = fakeStore();
  const service = new AdminService(store);
  const rule = await service.createPricingRule('admin-1', {
    cityId: null, serviceCode: 'CAR', mode: 'NEGOTIATION',
    baseFareMinor: 15000, perKmMinor: 5000, perMinMinor: 500,
    minimumFareMinor: 20000, bookingFeeMinor: 2000, demandCap: 1,
  });
  assert.equal(store.captured.length, 1);
  assert.equal(store.captured[0].action, 'PRICING_RULE_CREATED');
  assert.equal(store.captured[0].targetId, rule.id);
});
