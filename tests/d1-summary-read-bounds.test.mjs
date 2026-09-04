import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { CURRENT_DAILY_MINUTE_SUMMARY_SQL } from '../site/functions/lib/current-minute-summary.js';
import { FACTS_HISTORY_SINCE_SQL } from '../site/functions/lib/dashboard-facts.js';

test('current daily summary materializes one bounded minute scan without window reranking', () => {
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /prepared AS MATERIALIZED/);
  assert.doesNotMatch(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /ROW_NUMBER\(\) OVER/);
  assert.match(
    CURRENT_DAILY_MINUTE_SUMMARY_SQL,
    /f\.minute_at>=\?1 AND f\.minute_at<\?2/,
  );
  assert.match(
    CURRENT_DAILY_MINUTE_SUMMARY_SQL,
    /INDEXED BY idx_sh_minute_facts_source_channel_minute_desc/,
  );
});

test('dashboard history resolves daily members once per materialized day', () => {
  assert.match(FACTS_HISTORY_SINCE_SQL, /history AS MATERIALIZED/);
  assert.match(FACTS_HISTORY_SINCE_SQL, /history_days AS MATERIALIZED/);
  assert.match(FACTS_HISTORY_SINCE_SQL, /daily_members AS MATERIALIZED/);
  assert.match(FACTS_HISTORY_SINCE_SQL, /INDEXED BY idx_sh_total_member_daily_latest/);
  assert.doesNotMatch(FACTS_HISTORY_SINCE_SQL, /ROW_NUMBER\(\) OVER/);

  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_minute_facts(
    id INTEGER PRIMARY KEY,
    channel_id INTEGER NOT NULL,
    minute_at INTEGER NOT NULL,
    source_code INTEGER NOT NULL
  );
  CREATE INDEX idx_sh_minute_facts_live_minute
    ON sh_minute_facts(source_code,minute_at DESC,id DESC);
  CREATE TABLE sh_dashboard_history_5m(
    channel_id INTEGER NOT NULL,
    bucket_at INTEGER NOT NULL,
    observed_at INTEGER NOT NULL,
    listener_count INTEGER,
    online_member_count INTEGER,
    total_member_count INTEGER,
    total_listens INTEGER,
    comment_velocity INTEGER,
    PRIMARY KEY(channel_id,bucket_at)
  );
  CREATE TABLE sh_total_member_daily(
    channel_id INTEGER NOT NULL,
    day_at INTEGER NOT NULL,
    host_key INTEGER NOT NULL,
    last_observed_at INTEGER NOT NULL,
    last_total_member_count INTEGER
  );
  CREATE INDEX idx_sh_total_member_daily_latest
    ON sh_total_member_daily(
      channel_id,day_at,last_observed_at DESC,host_key,last_total_member_count
    );`);

  const day = Date.parse('2026-07-20T00:00:00Z');
  db.prepare('INSERT INTO sh_minute_facts VALUES(?,?,?,?)')
    .run(1, 318, day + 200_000, 1);
  const insertHistory = db.prepare(
    'INSERT INTO sh_dashboard_history_5m VALUES(?,?,?,?,?,?,?,?)',
  );
  insertHistory.run(318, day, day + 1_000, 10, 20, 100, 1_000, 1);
  insertHistory.run(318, day + 300_000, day + 301_000, 11, 21, 101, 1_001, 2);
  insertHistory.run(
    318,
    day + 86_400_000,
    day + 86_401_000,
    12,
    22,
    102,
    1_002,
    3,
  );
  const insertDaily = db.prepare('INSERT INTO sh_total_member_daily VALUES(?,?,?,?,?)');
  insertDaily.run(318, day, 2, day + 5_000, 500);
  insertDaily.run(318, day, 1, day + 6_000, 600);
  insertDaily.run(318, day, 3, day + 6_000, 700);

  const rows = db.prepare(FACTS_HISTORY_SINCE_SQL).all(day - 1);
  assert.deepEqual(rows.map((row) => row.total_member_count), [600, 600, 102]);

  const plan = db.prepare(`EXPLAIN QUERY PLAN ${FACTS_HISTORY_SINCE_SQL}`)
    .all(day - 1)
    .map((item) => item.detail)
    .join('\n');
  assert.match(
    plan,
    /idx_sh_total_member_daily_latest \(channel_id=\? AND day_at=\?\)/,
  );
});
