import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  PREVIOUS_DAY_HISTORY_SQL,
  STREAM_5M_HISTORY_SQL,
} from '../functions/lib/dashboard-chart-support.js';

const source = readFileSync(new URL('../functions/lib/dashboard-chart-support.js', import.meta.url), 'utf8');

test('previous-day chart query reads the 5-minute dashboard rollup by channel', () => {
  assert.match(PREVIOUS_DAY_HISTORY_SQL, /FROM sh_dashboard_history_5m AS r/);
  assert.match(PREVIOUS_DAY_HISTORY_SQL, /r\.channel_id=\?/);
  assert.match(PREVIOUS_DAY_HISTORY_SQL, /r\.bucket_at>=\? AND r\.bucket_at<\?/);
  assert.match(PREVIOUS_DAY_HISTORY_SQL, /LIMIT 300/);
});

test('stream chart reads bounded precomputed five-minute averages', () => {
  assert.match(STREAM_5M_HISTORY_SQL, /FROM sh_stream_5m_average_read_model AS d/);
  assert.match(STREAM_5M_HISTORY_SQL, /d\.channel_id=\?/);
  assert.match(STREAM_5M_HISTORY_SQL, /d\.bucket_at>=\? AND d\.bucket_at<\?/);
  assert.match(STREAM_5M_HISTORY_SQL, /d\.stream_delta_avg AS stream_delta/);
  assert.match(STREAM_5M_HISTORY_SQL, /d\.sample_count=5/);
  assert.match(STREAM_5M_HISTORY_SQL, /ORDER BY d\.bucket_at ASC/);
  assert.match(STREAM_5M_HISTORY_SQL, /LIMIT 300/);
});

test('five-minute stream averages are not derived in the Pages request path', () => {
  assert.doesNotMatch(source, /reported_current_stream_count/);
  assert.doesNotMatch(source, /AVG\(|GROUP BY|FROM sh_minute_facts/);
  assert.match(source, /payload\?\.latest\?\.channel_id/);
  assert.match(source, /stream_5m_history: streamRows/);
});

test('current dashboard chart augmentation no longer queries comment velocity fallback storage', () => {
  assert.doesNotMatch(source, /sh_comment_velocity_samples/);
  assert.doesNotMatch(source, /COMMENT_VELOCITY_FALLBACK_SQL|mergeVelocityFallback|velocityFallbackByBucket/);
  assert.match(source, /previous_day_history/);
});
