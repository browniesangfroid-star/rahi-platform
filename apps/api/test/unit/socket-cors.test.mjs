import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { socketCorsOrigins } from '../../dist/tracking/tracking.gateway.js';

test('socket CORS: local default, env list, wildcard never honoured', () => {
  delete process.env.SOCKET_CORS_ORIGINS;
  assert.deepEqual(socketCorsOrigins(), ['http://localhost:3000']);
  process.env.SOCKET_CORS_ORIGINS = 'https://admin.rahi.example, https://ops.rahi.example';
  assert.deepEqual(socketCorsOrigins(), ['https://admin.rahi.example', 'https://ops.rahi.example']);
  process.env.SOCKET_CORS_ORIGINS = '*';
  assert.deepEqual(socketCorsOrigins(), ['http://localhost:3000']);
  process.env.SOCKET_CORS_ORIGINS = '*, https://admin.rahi.example';
  assert.deepEqual(socketCorsOrigins(), ['https://admin.rahi.example']);
  delete process.env.SOCKET_CORS_ORIGINS;
});
