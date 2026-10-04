import test from 'node:test';
import assert from 'node:assert/strict';
import { createHealthCheck } from '../src/health.js';

const ok = async () => {};
const fail = async () => {
  throw new Error('down');
};
const hang = () => new Promise(() => {});

const check = ({ pg = ok, redis = ok, timeoutMs = 50 }) =>
  createHealthCheck({ pool: { query: pg }, redis: { ping: redis }, timeoutMs })();

test('both up', async () => {
  assert.deepEqual(await check({}), { postgres: 'ok', redis: 'ok' });
});

test('each one is reported on its own', async () => {
  assert.deepEqual(await check({ redis: fail }), { postgres: 'ok', redis: 'down' });
  assert.deepEqual(await check({ pg: fail }), { postgres: 'down', redis: 'ok' });
});

test('one that never answers is reported down after the timeout', async () => {
  const started = Date.now();
  assert.deepEqual(await check({ redis: hang }), { postgres: 'ok', redis: 'down' });
  assert.ok(Date.now() - started < 1000);
});
