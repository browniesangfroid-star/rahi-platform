import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionRide, transitionRide,
  canTransitionDelivery, transitionDelivery,
} from '../dist/index.js';

test('ride: legal transitions pass', () => {
  assert.equal(transitionRide('DRAFT', 'SEARCHING'), 'SEARCHING');
  assert.equal(transitionRide('WAITING_FOR_PIN', 'IN_PROGRESS'), 'IN_PROGRESS');
  assert.equal(transitionRide('IN_PROGRESS', 'COMPLETED'), 'COMPLETED');
});

test('ride: illegal transitions are rejected', () => {
  assert.equal(canTransitionRide('SEARCHING', 'COMPLETED'), false);
  assert.equal(canTransitionRide('COMPLETED', 'IN_PROGRESS'), false);
  assert.throws(() => transitionRide('IN_PROGRESS', 'DRIVER_ARRIVED'));
});

test('delivery: legal and illegal transitions', () => {
  assert.equal(transitionDelivery('REQUESTED', 'COURIER_SELECTED'), 'COURIER_SELECTED');
  assert.equal(canTransitionDelivery('DELIVERED', 'IN_TRANSIT'), false);
  assert.throws(() => transitionDelivery('DELIVERED', 'ARRIVED'));
});
