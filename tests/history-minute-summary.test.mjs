import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  minuteSummaryFallbackStart,
  minuteSummarySql,
} from '../site/functions/lib/history-summary.js';

const summarySource = readFileSync(
  new URL('../site/functions/lib/history-summary.js', import.meta.url),
  'utf8',
);
const rollupSource = readFileSync(
  new URL('../worker/src/rollup-maintenance.js', import.meta.url),
  'utf8',
);

test('minute history summary uses dense facts and current stream boundaries', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_channel_snapshots(
    id INTEGER PRIMARY KEY,
    observed_at INTEGER NOT NULL,
    listener_count INTEGER,
    total_member_count INTEGER,
    current_stream_count INTEGER,
    host_handle TEXT
  )`);
  const insert = db.prepare('INSERT INTO sh_channel_snapshots VALUES(?,?,?,?,?,?)');
  const start = Date.parse('2026-07-20T00:00:00Z');
  insert.run(1, start, 10, 800, 100, 'buddies');
  insert.run(2, start + 60_000, null, 801, 110, 'buddies');
  insert.run(3, start + 120_000, 30, 802, 130, 'buddies');

  const sql = minuteSummarySql('daily');
  const row = db.prepare(sql).get(start, start + 86_400_000, 10);
  assert.equal(row.period_key, '2026-07-20');
  assert.equal(row.sample_count, 3);
  assert.equal(row.reliable_sample_count, 2);
  assert.equal(row.listener_avg, 20);
  assert.equal(row.stream_start, 100);
  assert.equal(row.stream_end, 130);
  assert.equal(row.member_start, 800);
  assert.equal(row.member_end, 802);
  assert.equal(row.primary_host, 'buddies');
  assert.match(sql, /current_stream_count AS stream_value/);
  assert.doesNotMatch(sql, /validated_stream_count AS stream_value/);
});

test('daily minute overlay keeps a bounded fallback and starts after persisted rollups', () => {
  const now = Date.parse('2026-07-27T12:00:00Z');
  assert.equal(
    minuteSummaryFallbackStart('daily', now),
    Date.parse('2026-07-13T00:00:00Z'),
  );
  assert.match(
    summarySource,
    /Math\.max\(fromTs, expectedLiveStart, minuteSummaryFallbackStart\(mode, now\)\)/,
  );
});

test('offline history rollups use immutable dependency-gated promotion', () => {
  assert.match(rollupSource, /summaryExists\(otherDb, 'sh_daily_summary'/);
  assert.match(rollupSource, /insertDailyOnce\(db, minuteDb, otherDb, period, now\)/);
  assert.match(rollupSource, /daily-summaries-incomplete/);
  assert.match(rollupSource, /weekly-summaries-incomplete/);
  assert.match(rollupSource, /INSERT INTO sh_daily_summary/);
});
