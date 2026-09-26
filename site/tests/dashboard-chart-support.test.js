import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PREVIOUS_DAY_HISTORY_SQL,
  STREAM_MINUTE_HISTORY_SQL,
} from '../functions/lib/dashboard-chart-support.js';

const source = readFileSync(new URL('../functions/lib/dashboard-chart-support.js', import.meta.url), 'utf8');

test('previous-day chart query reads the 5-minute dashboard rollup', () => {
  assert.match(PREVIOUS_DAY_HISTORY_SQL, /FROM sh_dashboard_history_5m AS r/);
  assert.match(PREVIOUS_DAY_HISTORY_SQL, /r\.bucket_at>=\? AND r\.bucket_at<\?/);
  assert.match(PREVIOUS_DAY_HISTORY_SQL, /LIMIT 300/);
});

test('stream chart reads bounded one-minute facts with the channel-time index', () => {
  assert.match(STREAM_MINUTE_HISTORY_SQL, /FROM sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc/);
  assert.match(STREAM_MINUTE_HISTORY_SQL, /f\.minute_at>=\? AND f\.minute_at<\?/);
  assert.match(STREAM_MINUTE_HISTORY_SQL, /f\.reported_current_stream_count IS NOT NULL/);
  assert.match(STREAM_MINUTE_HISTORY_SQL, /ORDER BY f\.minute_at DESC,f\.id DESC/);
  assert.match(STREAM_MINUTE_HISTORY_SQL, /LIMIT 1600/);
});

test('one-minute stream deltas reject gaps and counter resets', () => {
  assert.match(source, /const gap = point\.observed_at - previous\.observed_at/);
  assert.match(source, /gap >= MINUTE_MS \/ 2/);
  assert.match(source, /gap <= MINUTE_MS \* 1\.5/);
  assert.match(source, /delta >= 0/);
  assert.match(source, /stream_minute_history: streamRows/);
});

test('current dashboard chart augmentation no longer queries comment velocity fallback storage', () => {
  assert.doesNotMatch(source, /sh_comment_velocity_samples/);
  assert.doesNotMatch(source, /COMMENT_VELOCITY_FALLBACK_SQL|mergeVelocityFallback|velocityFallbackByBucket/);
  assert.match(source, /previous_day_history/);
});
