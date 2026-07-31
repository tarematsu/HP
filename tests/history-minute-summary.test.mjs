import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { SAKURAZAKA_MINUTE_SERIES_SQL } from '../site/functions/api/sakurazaka46jp.js';
import {
  minuteSummaryFallbackStart,
  minuteSummarySql,
} from '../site/functions/lib/history-summary.js';

const summarySource = readFileSync(
  new URL('../site/functions/lib/history-summary.js', import.meta.url),
  'utf8',
);
const currentSource = readFileSync(
  new URL('../site/functions/api/history-current.js', import.meta.url),
  'utf8',
);
const rollupSource = readFileSync(
  new URL('../worker/src/rollup-maintenance.js', import.meta.url),
  'utf8',
);

test('minute history summary uses a bounded base-fact scan and current stream boundaries', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_minute_facts(
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL,
    minute_at INTEGER NOT NULL,
    observed_at INTEGER NOT NULL,
    listener_count INTEGER,
    total_member_count INTEGER,
    reported_current_stream_count INTEGER
  );
  CREATE INDEX idx_sh_minute_facts_observed_id
    ON sh_minute_facts(observed_at DESC,id DESC);
  CREATE TABLE sh_minute_fact_context(fact_id INTEGER PRIMARY KEY,host_id INTEGER);
  CREATE TABLE sh_hosts(id INTEGER PRIMARY KEY,current_handle TEXT);
  CREATE TABLE sh_total_member_daily_latest(
    channel_id INTEGER,
    day_at INTEGER,
    last_total_member_count INTEGER
  )`);
  const insertFact = db.prepare('INSERT INTO sh_minute_facts VALUES(?,?,?,?,?,?,?)');
  const insertContext = db.prepare('INSERT INTO sh_minute_fact_context VALUES(?,?)');
  const start = Date.parse('2026-07-20T00:00:00Z');
  db.prepare('INSERT INTO sh_hosts VALUES(?,?)').run(1, 'buddies');
  insertFact.run(1, 1, start, start, 10, 800, 100);
  insertFact.run(2, 1, start + 60_000, start + 60_000, null, 801, 110);
  insertFact.run(3, 1, start + 120_000, start + 120_000, 30, 802, 130);
  insertContext.run(1, 1);
  insertContext.run(2, 1);
  insertContext.run(3, 1);

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
  assert.match(sql, /FROM sh_minute_facts f INDEXED BY idx_sh_minute_facts_observed_id/);
  assert.match(sql, /WHERE f\.observed_at>=\? AND f\.observed_at<\?/);
  assert.doesNotMatch(sql, /FROM sh_channel_snapshots/);
  assert.match(sql, /reported_current_stream_count AS stream_value/);
  assert.doesNotMatch(sql, /validated_stream_count AS stream_value/);
});

test('Sakurazaka minute series forces the minute range index', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_minute_facts(
    id INTEGER PRIMARY KEY,
    minute_at INTEGER NOT NULL,
    broadcast_session_id INTEGER,
    listener_count INTEGER
  );
  CREATE INDEX idx_sh_minute_facts_time ON sh_minute_facts(minute_at ASC,id ASC);
  CREATE TABLE sh_minute_fact_context(fact_id INTEGER PRIMARY KEY,host_id INTEGER);
  CREATE TABLE sh_broadcast_sessions(id INTEGER PRIMARY KEY,host_id INTEGER);
  CREATE TABLE sh_hosts(id INTEGER PRIMARY KEY,current_handle TEXT)`);
  const start = Date.parse('2026-07-20T00:00:00Z');
  db.prepare('INSERT INTO sh_hosts VALUES(?,?)').run(1, 'sakurazaka46jp');
  db.prepare('INSERT INTO sh_minute_facts VALUES(?,?,?,?)').run(1, start, null, 10);
  db.prepare('INSERT INTO sh_minute_facts VALUES(?,?,?,?)').run(2, start + 60_000, null, 20);
  db.prepare('INSERT INTO sh_minute_fact_context VALUES(?,?)').run(1, 1);
  db.prepare('INSERT INTO sh_minute_fact_context VALUES(?,?)').run(2, 1);

  const row = db.prepare(SAKURAZAKA_MINUTE_SERIES_SQL)
    .get(start, start, start + 120_000);
  assert.match(
    SAKURAZAKA_MINUTE_SERIES_SQL,
    /FROM sh_minute_facts f INDEXED BY idx_sh_minute_facts_time/,
  );
  assert.equal(row.point_count, 2);
  assert.deepEqual(JSON.parse(row.points_json), [[0, 10, 1], [1, 20, 1]]);
});

test('minute scans are reserved for the bounded current UTC daily endpoint', () => {
  const now = Date.parse('2026-07-27T12:00:00Z');
  assert.equal(
    minuteSummaryFallbackStart('daily', now),
    Date.parse('2026-07-13T00:00:00Z'),
  );
  assert.match(currentSource, /minuteSummarySql\('daily'\)/);
  assert.match(currentSource, /currentSummaryPeriodStart\('daily', now\)/);
  assert.doesNotMatch(summarySource, /MINUTE_DB\.prepare\(minuteSummarySql/);
  assert.match(summarySource, /live_source: 'summary-only'/);
});

test('offline rollups reconcile missing Minute Facts before rebuilding summaries', () => {
  assert.match(rollupSource, /reconcileMinuteFactsForDay/);
  assert.match(rollupSource, /minuteFactReconcileCandidates\(now\)/);
  assert.match(rollupSource, /minute-facts-incomplete/);
  assert.match(rollupSource, /rebuildDailyWhenComplete/);
  assert.match(rollupSource, /daily-summaries-incomplete/);
  assert.match(rollupSource, /weekly-summaries-incomplete/);
  assert.match(rollupSource, /rollupDaily\(minuteDb, otherDb, period, now, qualityFlags\)/);
});
