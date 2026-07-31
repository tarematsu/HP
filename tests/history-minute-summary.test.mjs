import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { SAKURAZAKA_MINUTE_SERIES_SQL } from '../site/functions/api/sakurazaka46jp.js';
import { CURRENT_DAILY_MINUTE_SUMMARY_SQL } from '../site/functions/lib/current-minute-summary.js';
import { minuteSummaryFallbackStart } from '../site/functions/lib/history-summary.js';

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

test('current daily history seeks canonical minute_at and ignores today-imported old facts', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_minute_facts(
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL,
    minute_at INTEGER NOT NULL,
    observed_at INTEGER NOT NULL,
    listener_count INTEGER,
    total_member_count INTEGER,
    reported_current_stream_count INTEGER,
    broadcast_session_id INTEGER,
    UNIQUE(channel_id,minute_at)
  );
  CREATE INDEX idx_sh_minute_facts_time
    ON sh_minute_facts(minute_at ASC,id ASC);
  CREATE TABLE sh_minute_fact_context_v2(
    fact_id INTEGER PRIMARY KEY,
    host_id_override INTEGER
  );
  CREATE TABLE sh_broadcast_sessions(id INTEGER PRIMARY KEY,host_id INTEGER);
  CREATE TABLE sh_hosts(id INTEGER PRIMARY KEY,current_handle TEXT);
  CREATE TABLE sh_total_member_daily_latest(
    channel_id INTEGER,
    day_at INTEGER,
    last_total_member_count INTEGER
  )`);
  const insertFact = db.prepare('INSERT INTO sh_minute_facts VALUES(?,?,?,?,?,?,?,?)');
  const insertContext = db.prepare('INSERT INTO sh_minute_fact_context_v2 VALUES(?,?)');
  const start = Date.parse('2026-07-20T00:00:00Z');
  db.prepare('INSERT INTO sh_hosts VALUES(?,?)').run(1, 'buddies');
  insertFact.run(1, 1, start, start, 10, 800, 100, null);
  insertFact.run(2, 1, start + 60_000, start + 60_000, null, 801, 110, null);
  insertFact.run(3, 1, start + 120_000, start + 120_000, 30, 802, 130, null);
  // A historical repair received today must not enter today's graph.
  insertFact.run(4, 2, start - 86_400_000, start + 180_000, 999, 999, 999, null);
  insertContext.run(1, 1);
  insertContext.run(2, 1);
  insertContext.run(3, 1);

  const row = db.prepare(CURRENT_DAILY_MINUTE_SUMMARY_SQL)
    .get(start, start + 86_400_000, 10);
  assert.equal(row.period_key, '2026-07-20');
  assert.equal(row.sample_count, 3);
  assert.equal(row.reliable_sample_count, 2);
  assert.equal(row.listener_avg, 20);
  assert.equal(row.stream_start, 100);
  assert.equal(row.stream_end, 130);
  assert.equal(row.member_start, 800);
  assert.equal(row.member_end, 802);
  assert.equal(row.primary_host, 'buddies');
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /f\.minute_at AS observed_at/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /INDEXED BY idx_sh_minute_facts_time/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /WHERE f\.minute_at>=\? AND f\.minute_at<\?/);
  assert.doesNotMatch(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /idx_sh_minute_facts_observed_id|sh_channel_snapshots/);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${CURRENT_DAILY_MINUTE_SUMMARY_SQL}`)
    .all(start, start + 86_400_000, 10)
    .map((item) => item.detail).join('\n');
  assert.match(plan, /idx_sh_minute_facts_time \(minute_at>\? AND minute_at<\?\)/);
});

test('Sakurazaka series resolves target channels before fact range seeks', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_hosts(id INTEGER PRIMARY KEY,current_handle TEXT);
  CREATE TABLE sh_broadcast_sessions(
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL,
    host_id INTEGER,
    broadcast_start_time INTEGER,
    first_observed_at INTEGER NOT NULL,
    last_observed_at INTEGER NOT NULL,
    ended_at INTEGER
  );
  CREATE INDEX idx_sh_broadcast_sessions_host_window
    ON sh_broadcast_sessions(host_id,first_observed_at,last_observed_at,channel_id)
    WHERE host_id IS NOT NULL;
  CREATE TABLE sh_minute_facts(
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL,
    minute_at INTEGER NOT NULL,
    listener_count INTEGER,
    broadcast_session_id INTEGER,
    UNIQUE(channel_id,minute_at)
  );
  CREATE INDEX idx_sh_minute_facts_time ON sh_minute_facts(minute_at ASC,id ASC);
  CREATE TABLE sh_minute_fact_context_v2(fact_id INTEGER PRIMARY KEY,host_id_override INTEGER);
  CREATE INDEX idx_sh_minute_fact_context_host_fact
    ON sh_minute_fact_context_v2(host_id_override,fact_id)
    WHERE host_id_override IS NOT NULL`);
  const start = Date.parse('2026-07-20T00:00:00Z');
  const end = start + 240_000;
  db.prepare('INSERT INTO sh_hosts VALUES(?,?)').run(1, 'sakurazaka46jp');
  db.prepare('INSERT INTO sh_broadcast_sessions VALUES(?,?,?,?,?,?,?)')
    .run(10, 1, 1, start, start, end - 60_000, end - 60_000);
  const insertFact = db.prepare('INSERT INTO sh_minute_facts VALUES(?,?,?,?,?)');
  insertFact.run(1, 1, start, 10, 10);
  insertFact.run(2, 1, start + 60_000, 20, 10);
  insertFact.run(3, 2, start + 120_000, 30, null);
  insertFact.run(4, 2, start + 180_000, 40, null);
  db.prepare('INSERT INTO sh_minute_fact_context_v2 VALUES(?,?)').run(3, 1);
  db.prepare('INSERT INTO sh_minute_fact_context_v2 VALUES(?,?)').run(4, 1);
  let id = 100;
  for (let channel = 3; channel < 103; channel += 1) {
    for (let minute = start; minute < end; minute += 60_000) {
      insertFact.run(id, channel, minute, 999, null);
      id += 1;
    }
  }

  const row = db.prepare(SAKURAZAKA_MINUTE_SERIES_SQL).get(start, start, end);
  assert.equal(row.point_count, 4);
  assert.deepEqual(JSON.parse(row.points_json), [[0, 10, 1], [1, 20, 1], [2, 30, 1], [3, 40, 1]]);
  assert.match(SAKURAZAKA_MINUTE_SERIES_SQL, /CROSS JOIN sh_minute_facts f INDEXED BY sqlite_autoindex_sh_minute_facts_1/);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${SAKURAZAKA_MINUTE_SERIES_SQL}`)
    .all(start, start, end)
    .map((item) => item.detail).join('\n');
  assert.match(plan, /idx_sh_broadcast_sessions_host_window \(host_id=\?\)/);
  assert.match(plan, /idx_sh_minute_fact_context_host_fact \(host_id_override=\?\)/);
  assert.match(plan, /sqlite_autoindex_sh_minute_facts_1 \(channel_id=\? AND minute_at>\? AND minute_at<\?\)/);
  assert.doesNotMatch(plan, /SCAN f USING INDEX idx_sh_minute_facts_time/);
});

test('minute scans are reserved for the bounded current UTC daily endpoint', () => {
  const now = Date.parse('2026-07-27T12:00:00Z');
  assert.equal(
    minuteSummaryFallbackStart('daily', now),
    Date.parse('2026-07-13T00:00:00Z'),
  );
  assert.match(currentSource, /CURRENT_DAILY_MINUTE_SUMMARY_SQL/);
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
