import test from 'node:test';
import assert from 'node:assert/strict';
import { OtpRateLimiter } from '../../dist/auth/otp-rate-limiter.js';
import { RedisOtpRateLimiter } from '../../dist/auth/redis-otp-rate-limiter.js';

test('otp rate limiter: 5 allowed, 6th blocked', async () => {
  const limiter = new OtpRateLimiter();
  for (let i = 0; i < 5; i++) assert.equal(await limiter.allow('otp:+923001234567'), true);
  assert.equal(await limiter.allow('otp:+923001234567'), false);
  assert.equal(await limiter.allow('otp:+923009999999'), true);
});

test('redis otp rate limiter: same 5-per-window contract via a stub client', async () => {
  // Stub honours the Lua script's contract: INCR, EXPIRE on first hit.
  const counts = new Map();
  const stub = {
    async eval(_script, _numKeys, key) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
  };
  const limiter = new RedisOtpRateLimiter(stub);
  for (let i = 0; i < 5; i++) assert.equal(await limiter.allow('otp:+923001234567'), true);
  assert.equal(await limiter.allow('otp:+923001234567'), false);
  assert.equal(await limiter.allow('otp:+923009999999'), true);
});
