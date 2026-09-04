import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { loadCurrentMinuteSummary } from '../site/functions/api/history-current.js';
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

test('current daily history seeks canonical minute_at and stays on the latest live channel', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_minute_facts(
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL,
    minute_at INTEGER NOT NULL,
    observed_at INTEGER NOT NULL,
    source_code INTEGER NOT NULL,
    listener_count INTEGER,
    total_member_count INTEGER,
    reported_current_stream_count INTEGER,
    broadcast_session_id INTEGER,
    UNIQUE(channel_id,minute_at)
  );
  CREATE INDEX idx_sh_minute_facts_time
    ON sh_minute_facts(minute_at ASC,id ASC);
  CREATE INDEX idx_sh_minute_facts_source_channel_minute_desc
    ON sh_minute_facts(source_code,channel_id,minute_at DESC,id DESC);
  CREATE INDEX idx_sh_minute_facts_live_minute
    ON sh_minute_facts(source_code,minute_at DESC,id DESC);
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
  const insertFact = db.prepare('INSERT INTO sh_minute_facts VALUES(?,?,?,?,?,?,?,?,?)');
  const insertContext = db.prepare('INSERT INTO sh_minute_fact_context_v2 VALUES(?,?)');
  const start = Date.parse('2026-07-20T00:00:00Z');
  db.prepare('INSERT INTO sh_hosts VALUES(?,?)').run(1, 'buddies');
  insertFact.run(1, 1, start, start, 1, 10, 800, 100, null);
  insertFact.run(2, 1, start + 60_000, start + 60_000, 1, null, 801, 110, null);
  insertFact.run(3, 1, start + 120_000, start + 120_000, 1, 30, 802, 130, null);
  // A historical repair received today must not enter today's graph.
  insertFact.run(4, 2, start - 86_400_000, start + 180_000, 2, 999, 999, 999, null);
  // Another live channel in the same UTC day must not inflate the daily count.
  insertFact.run(5, 2, start + 60_000, start + 60_000, 1, 777, 900, 777, null);
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
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /INDEXED BY idx_sh_minute_facts_source_channel_minute_desc/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /INDEXED BY idx_sh_minute_facts_live_minute/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /WHERE f\.source_code=1/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /f\.channel_id=\(SELECT channel_id FROM latest_channel\)/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /f\.minute_at>=\? AND f\.minute_at<\?/);
  assert.doesNotMatch(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /idx_sh_minute_facts_observed_id|sh_channel_snapshots/);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${CURRENT_DAILY_MINUTE_SUMMARY_SQL}`)
    .all(start, start + 86_400_000, 10)
    .map((item) => item.detail).join('\n');
  assert.match(
    plan,
    /idx_sh_minute_facts_source_channel_minute_desc \(source_code=\? AND channel_id=\? AND minute_at>\? AND minute_at<\?\)/,
  );
  assert.match(plan, /idx_sh_minute_facts_live_minute/);
});

test('current daily history rejects an impossible sample count', async () => {
  const now = Date.parse('2026-07-20T12:00:00Z');
  const env = {
    MINUTE_DB: {
      prepare() {
        return {
          bind() {
            return {
              async all() {
                return {
                  results: [{
                    period_key: '2026-07-20',
                    period_start: Date.parse('2026-07-20T00:00:00Z'),
                    period_end: now,
                    sample_count: 1441,
                    reliable_sample_count: 1441,
                    listener_avg: 10,
                    listener_min: 10,
                    listener_max: 10,
                    stream_start: 1,
                    stream_end: 2,
                    member_start: 3,
                    member_end: 4,
                    primary_host: 'buddies',
                  }],
                };
              },
            };
          },
        };
      },
    },
  };
  await assert.rejects(
    loadCurrentMinuteSummary(env, 'daily', now),
    /current daily sample_count is invalid: 1441/,
  );
});

test('Sakurazaka series seeks only target broadcast sessions and sparse overrides', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_hosts(id INTEGER PRIMARY KEY,current_handle TEXT);
  CREATE TABLE sh_broadcast_sessions(id INTEGER PRIMARY KEY,host_id INTEGER);
  CREATE INDEX idx_sh_broadcast_sessions_host_id
    ON sh_broadcast_sessions(host_id,id) WHERE host_id IS NOT NULL;
  CREATE TABLE sh_minute_facts(
    id INTEGER PRIMARY KEY,
    minute_at INTEGER NOT NULL,
    source_code INTEGER NOT NULL,
    listener_count INTEGER,
    broadcast_session_id INTEGER
  );
  CREATE INDEX idx_sh_minute_facts_time ON sh_minute_facts(minute_at ASC,id ASC);
  CREATE INDEX idx_sh_minute_facts_session_minute
    ON sh_minute_facts(broadcast_session_id,minute_at,id)
    WHERE broadcast_session_id IS NOT NULL;
  CREATE TABLE sh_minute_fact_context_v2(
    fact_id INTEGER PRIMARY KEY,
    host_id_override INTEGER
  );
  CREATE INDEX idx_sh_minute_fact_context_host_fact
    ON sh_minute_fact_context_v2(host_id_override,fact_id)
    WHERE host_id_override IS NOT NULL`);
  const start = Date.parse('2026-07-20T00:00:00Z');
  const end = start + 240_000;
  db.prepare('INSERT INTO sh_hosts VALUES(?,?)').run(1, 'sakurazaka46jp');
  db.prepare('INSERT INTO sh_hosts VALUES(?,?)').run(2, 'other');
  db.prepare('INSERT INTO sh_broadcast_sessions VALUES(?,?)').run(10, 1);
  db.prepare('INSERT INTO sh_broadcast_sessions VALUES(?,?)').run(20, 2);
  const insertFact = db.prepare('INSERT INTO sh_minute_facts VALUES(?,?,?,?,?)');
  insertFact.run(1, start, 1, 10, 10);
  insertFact.run(2, start + 60_000, 1, 20, 10);
  insertFact.run(3, start + 120_000, 1, 30, null);
  insertFact.run(4, start + 180_000, 1, 40, null);
  db.prepare('INSERT INTO sh_minute_fact_context_v2 VALUES(?,?)').run(3, 1);
  db.prepare('INSERT INTO sh_minute_fact_context_v2 VALUES(?,?)').run(4, 1);
  for (let id = 100; id < 1100; id += 1) {
    insertFact.run(id, start + ((id - 100) % 4) * 60_000, 1, 999, 20);
  }

  const row = db.prepare(SAKURAZAKA_MINUTE_SERIES_SQL).get(start, start, end);
  assert.equal(row.point_count, 4);
  assert.deepEqual(JSON.parse(row.points_json), [[0, 10, 1], [1, 20, 1], [2, 30, 1], [3, 40, 1]]);
  assert.match(SAKURAZAKA_MINUTE_SERIES_SQL, /CROSS JOIN sh_minute_facts f/);
  assert.match(SAKURAZAKA_MINUTE_SERIES_SQL, /CROSS JOIN sh_minute_fact_context_v2 c/);
  assert.match(SAKURAZAKA_MINUTE_SERIES_SQL, /c\.host_id_override=h\.id/);
  assert.doesNotMatch(SAKURAZAKA_MINUTE_SERIES_SQL, /CROSS JOIN sh_minute_fact_context c/);
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${SAKURAZAKA_MINUTE_SERIES_SQL}`)
    .all(start, start, end)
    .map((item) => item.detail).join('\n');
  assert.match(plan, /idx_sh_broadcast_sessions_host_id \(host_id=\?\)/);
  assert.match(plan, /idx_sh_minute_facts_session_minute \(broadcast_session_id=\? AND minute_at>\? AND minute_at<\?\)/);
  assert.match(plan, /idx_sh_minute_fact_context_host_fact \(host_id_override=\?\)/);
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
  assert.match(rollupSource, /rollupMinuteDaily\(minuteDb, otherDb, period, now, qualityFlags\)/);
});
