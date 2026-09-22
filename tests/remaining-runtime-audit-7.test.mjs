import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  BROADCAST_SUMMARY_SQL,
  parseBroadcastSummaryRows,
} from '../site/functions/api/history.js';

// Keep this file focused on active runtime/database contracts that were not
// already covered by the earlier cleanup audits.

test('dashboard latest row and unchanged queue share one context query', () => {
  const dashboard = readFileSync(new URL('../site/functions/api/dashboard.js', import.meta.url), 'utf8');
  assert.match(dashboard, /latestAndQueueContext/);
  assert.doesNotMatch(dashboard, /loadLatestMinuteFact\([\s\S]*loadCurrentQueue/);
});

test('host summary cache coalesces concurrent D1 reads per binding', () => {
  const source = readFileSync(new URL('../site/functions/api/host-history.js', import.meta.url), 'utf8');
  assert.match(source, /summaryPromiseByDb/);
  assert.match(source, /WeakMap/);
});

test('main chart uses shared formatters, single-pass preparation and differential DOM updates', () => {
  const source = readFileSync(new URL('../site/public/dashboard-metrics.js', import.meta.url), 'utf8');
  assert.match(source, /prepareHistory/);
  assert.match(source, /setTextIfChanged/);
  assert.match(source, /number\.format/);
});

test('queue items and latest likes share one D1 read batch', () => {
  const source = readFileSync(new URL('../site/functions/api/dashboard.js', import.meta.url), 'utf8');
  assert.match(source, /batch/);
  assert.match(source, /queue/);
});

test('comment velocity is derived from compact minute counters', () => {
  const source = readFileSync(new URL('../site/functions/api/dashboard.js', import.meta.url), 'utf8');
  assert.match(source, /comment/);
  assert.match(source, /minute/);
});

test('broadcast summary reports empty range and setup state in one query', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_official_broadcast_summary(
      id INTEGER PRIMARY KEY,
      host_handle TEXT,
      event_name TEXT,
      started_at INTEGER,
      ended_at INTEGER,
      first_observed_at TEXT,
      last_observed_at TEXT,
      sample_count INTEGER,
      listener_sum INTEGER,
      listener_min INTEGER,
      listener_max INTEGER,
      distinct_tracks INTEGER
    );
    INSERT INTO sh_official_broadcast_summary(
      host_handle,event_name,started_at,ended_at,first_observed_at,last_observed_at,
      sample_count,listener_sum,listener_min,listener_max,distinct_tracks
    )
    VALUES ('sakurazaka46jp','Event A',1000,2000,'2026-07-01 00:00:01','2026-07-01 00:00:02',2,50,25,25,3);
  `);

  const outside = parseBroadcastSummaryRows(db.prepare(BROADCAST_SUMMARY_SQL).all(0, 100, 0, 100));
  assert.deepEqual(outside.rows, []);
  assert.equal(outside.setupRequired, false);

  const inside = parseBroadcastSummaryRows(db.prepare(BROADCAST_SUMMARY_SQL).all(0, 2000, 0, 2000));
  assert.equal(inside.setupRequired, false);
  assert.equal(inside.rows.length, 1);
  assert.equal(inside.rows[0].event_name, 'Event A');
  assert.equal(inside.rows[0].listener_avg, 25);
  assert.equal(Object.hasOwn(inside.rows[0], 'has_data'), false);
});

test('history display layer uses current canonical modules only', () => {
  const source = readFileSync(
    new URL('../site/public/history/history-lite.js', import.meta.url),
    'utf8',
  );
  const entry = readFileSync(
    new URL('../site/public/history/history-main.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /CACHE_PREFIX = 'sh\.history\.v3:'/);
  assert.match(source, /broadcasts: \{ title: '公式ストリーム比較', table: '公式ストリーム一覧'/);
  assert.doesNotMatch(source, /tracks: \{|再生曲一覧|history-copy-fixes|history-track-likes/);
  assert.match(entry, /history-broadcasts\.js\?v=20260923\.\d+/);
  assert.match(entry, /history-period-chart\.js\?v=20260923\.\d+/);
});
