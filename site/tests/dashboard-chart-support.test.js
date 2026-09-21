import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMENT_VELOCITY_FALLBACK_SQL,
  PREVIOUS_DAY_HISTORY_SQL,
  mergeVelocityFallback,
  velocityFallbackByBucket,
} from '../functions/lib/dashboard-chart-support.js';

test('previous-day chart query reads the 5-minute dashboard rollup', () => {
  assert.match(PREVIOUS_DAY_HISTORY_SQL, /FROM sh_dashboard_history_5m AS r/);
  assert.match(PREVIOUS_DAY_HISTORY_SQL, /r\.bucket_at>=\? AND r\.bucket_at<\?/);
  assert.match(PREVIOUS_DAY_HISTORY_SQL, /LIMIT 300/);
});

test('comment velocity fallback aggregates persisted solo samples into five-minute buckets', () => {
  assert.match(COMMENT_VELOCITY_FALLBACK_SQL, /FROM sh_comment_velocity_samples/);
  assert.match(COMMENT_VELOCITY_FALLBACK_SQL, /source_scope='solo'/);
  assert.match(COMMENT_VELOCITY_FALLBACK_SQL, /MAX\(comment_velocity\)/);
  assert.match(COMMENT_VELOCITY_FALLBACK_SQL, /GROUP BY bucket_at/);
  assert.match(COMMENT_VELOCITY_FALLBACK_SQL, /LIMIT 600/);
});

test('comment velocity fallback accepts pre-aggregated and raw five-minute samples', () => {
  const base = Date.parse('2026-09-21T02:45:00Z');
  const buckets = velocityFallbackByBucket([
    { bucket_at: base, comment_velocity: 37 },
    { observed_at: base + 310_000, comment_velocity: 8 },
  ]);
  assert.equal(buckets.get(base), 37);
  assert.equal(buckets.get(base + 300_000), 8);
});

test('comment velocity fallback recovers missing rollup values without lowering real values', () => {
  const base = Date.parse('2026-09-21T02:45:00Z');
  const fallback = new Map([[base, 44]]);
  assert.deepEqual(mergeVelocityFallback([
    { bucket_at: base, observed_at: base + 240_000, comment_velocity: 0 },
    { bucket_at: base, observed_at: base + 240_000, comment_velocity: 61 },
  ], fallback), [
    { bucket_at: base, observed_at: base + 240_000, comment_velocity: 44 },
    { bucket_at: base, observed_at: base + 240_000, comment_velocity: 61 },
  ]);
});
