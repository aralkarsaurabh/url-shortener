import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetrics, noMetrics } from '../src/metrics.js';

test('counts, adds amounts, and can be reset', () => {
  const metrics = createMetrics();
  metrics.inc('a');
  metrics.inc('a');
  metrics.inc('b', 5);
  assert.deepEqual(metrics.snapshot(), { a: 2, b: 5 });
  metrics.reset();
  assert.deepEqual(metrics.snapshot(), {});
});

test('a snapshot is a copy', () => {
  const metrics = createMetrics();
  metrics.inc('a');
  const snapshot = metrics.snapshot();
  metrics.inc('a');
  assert.equal(snapshot.a, 1);
});

test('noMetrics accepts everything and keeps nothing', () => {
  noMetrics.inc('a');
  assert.deepEqual(noMetrics.snapshot(), {});
});
