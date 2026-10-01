import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  CURRENT_HISTORY_SQL,
  PREVIOUS_DAY_HISTORY_SQL,
  directFiveMinuteStreamHistory,
} from '../functions/lib/dashboard-chart-support.js';

const source = readFileSync(new URL('../functions/lib/dashboard-chart-support.js', import.meta.url), 'utf8');

test('current and previous-day chart queries use the compact 5-minute dashboard rollup', () => {
  for (const sql of [CURRENT_HISTORY_SQL, PREVIOUS_DAY_HISTORY_SQL]) {
    assert.match(sql, /FROM sh_dashboard_history_5m AS r/);
    assert.match(sql, /r\.channel_id=\?/);
    assert.match(sql, /r\.bucket_at>=\? AND r\.bucket_at<\?/);
    assert.match(sql, /ORDER BY r\.bucket_at ASC/);
    assert.match(sql, /LIMIT 300/);
  }
  assert.match(CURRENT_HISTORY_SQL, /r\.current_stream_count/);
});

test('previous-day chart ordering follows the primary-key range without a temporary sort', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_dashboard_history_5m (
      channel_id INTEGER NOT NULL,
      bucket_at INTEGER NOT NULL,
      fact_id INTEGER NOT NULL,
      minute_at INTEGER NOT NULL,
      observed_at INTEGER NOT NULL,
      listener_count INTEGER,
      online_member_count INTEGER,
      total_member_count INTEGER,
      total_listens INTEGER,
      current_stream_count INTEGER,
      comment_velocity INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(channel_id,bucket_at)
    ) WITHOUT ROWID;
  `);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${PREVIOUS_DAY_HISTORY_SQL}`)
    .all(318, 0, 86_400_000)
    .map(({ detail }) => String(detail))
    .join('\n');
  assert.match(plan, /PRIMARY KEY/);
  assert.match(plan, /channel_id=\?/);
  assert.match(plan, /bucket_at>\?/);
  assert.doesNotMatch(plan, /TEMP B-TREE/);
});

test('stream chart converts rolling 15-minute growth back to a five-minute equivalent', () => {
  const base = 1_800_000_000_000;
  assert.deepEqual(directFiveMinuteStreamHistory([
    { observed_at: base, current_stream_count: 10 },
    { observed_at: base + 300_000, current_stream_count: 16 },
    { observed_at: base + 600_000, current_stream_count: 25 },
    { observed_at: base + 900_000, current_stream_count: 40 },
    { observed_at: base + 1_200_000, current_stream_count: 58 },
  ]), [
    { observed_at: base + 900_000, stream_delta: 10, sample_count: 3 },
    { observed_at: base + 1_200_000, stream_delta: 14, sample_count: 3 },
  ]);
});

test('15-minute smoothing omits windows with missing buckets or counter resets', () => {
  const base = 1_800_000_000_000;
  assert.deepEqual(directFiveMinuteStreamHistory([
    { observed_at: base, current_stream_count: 100 },
    { observed_at: base + 300_000, current_stream_count: 110 },
    { observed_at: base + 600_000, current_stream_count: 90 },
    { observed_at: base + 900_000, current_stream_count: 120 },
    { observed_at: base + 1_500_000, current_stream_count: 140 },
  ]), []);
});

test('Pages request path no longer reads or averages minute stream facts', () => {
  assert.doesNotMatch(source, /sh_stream_5m_average_read_model/);
  assert.doesNotMatch(source, /reported_current_stream_count/);
  assert.doesNotMatch(source, /AVG\(|GROUP BY|FROM sh_minute_facts/);
  assert.match(source, /directFiveMinuteStreamHistory\(history\)/);
});

test('current dashboard chart augmentation no longer queries comment velocity fallback storage', () => {
  assert.doesNotMatch(source, /sh_comment_velocity_samples/);
  assert.doesNotMatch(source, /COMMENT_VELOCITY_FALLBACK_SQL|mergeVelocityFallback|velocityFallbackByBucket/);
  assert.match(source, /previous_day_history/);
});
