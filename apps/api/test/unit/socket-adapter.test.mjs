import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseRedisSocketAdapter } from '../../dist/tracking/tracking.gateway.js';

test('socket adapter: redis adapter only when REDIS_URL is set', () => {
  delete process.env.REDIS_URL;
  assert.equal(shouldUseRedisSocketAdapter(), false);
  process.env.REDIS_URL = 'redis://localhost:6379';
  assert.equal(shouldUseRedisSocketAdapter(), true);
  delete process.env.REDIS_URL;
});
