import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { CURRENT_DAILY_MINUTE_SUMMARY_SQL } from '../site/functions/lib/current-minute-summary.js';
import {
  FACTS_HISTORY_SINCE_SQL,
  applyDashboardHistoryDailyMembers,
  dashboardHistoryDailyMembersSql,
} from '../site/functions/lib/dashboard-facts.js';

test('current daily summary reads the incremental one-row projection', () => {
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /FROM sh_current_daily_summary AS p/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /p\.day_at=\?1/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /INDEXED BY idx_sh_minute_facts_live_minute/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /INDEXED BY idx_sh_total_member_daily_latest/);
  assert.doesNotMatch(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /prepared AS MATERIALIZED/);
  assert.doesNotMatch(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /FROM sh_minute_facts f INDEXED BY idx_sh_minute_facts_source_channel_minute_desc/);
  assert.doesNotMatch(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /ROW_NUMBER\(\) OVER/);
});

function d1Adapter(sqlite) {
  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind(...bindings) {
          return {
            async all() {
              return { results: statement.all(...bindings) };
            },
          };
        },
      };
    },
  };
}

test('dashboard history scans the rollup once and resolves members only for returned days', async () => {
  assert.doesNotMatch(FACTS_HISTORY_SINCE_SQL, /MATERIALIZED|history_days|daily_members/);
  assert.doesNotMatch(FACTS_HISTORY_SINCE_SQL, /sh_total_member_daily/);
  assert.match(FACTS_HISTORY_SINCE_SQL, /r\.channel_id=\?1/);
  assert.match(FACTS_HISTORY_SINCE_SQL, /r\.bucket_at>=\?2-300000/);
  assert.match(FACTS_HISTORY_SINCE_SQL, /r\.observed_at>\?2/);
  assert.match(FACTS_HISTORY_SINCE_SQL, /ORDER BY r\.bucket_at ASC/);

  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_dashboard_history_5m(
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

  const rows = db.prepare(FACTS_HISTORY_SINCE_SQL).all(318, day - 1);
  assert.deepEqual(rows.map((row) => row.total_member_count), [100, 101, 102]);
  const corrected = await applyDashboardHistoryDailyMembers(d1Adapter(db), 318, rows);
  assert.deepEqual(corrected.map((row) => row.total_member_count), [600, 600, 102]);

  const historyPlan = db.prepare(`EXPLAIN QUERY PLAN ${FACTS_HISTORY_SINCE_SQL}`)
    .all(318, day - 1)
    .map((item) => item.detail)
    .join('\n');
  assert.match(historyPlan, /sh_dashboard_history_5m.*channel_id=\? AND bucket_at>\?/);
  assert.doesNotMatch(historyPlan, /USE TEMP B-TREE FOR ORDER BY/);

  const memberPlan = db.prepare(`EXPLAIN QUERY PLAN ${dashboardHistoryDailyMembersSql(2)}`)
    .all(318, day, day + 86_400_000)
    .map((item) => item.detail)
    .join('\n');
  assert.match(memberPlan, /idx_sh_total_member_daily_latest \(channel_id=\? AND day_at=\?\)/);
});