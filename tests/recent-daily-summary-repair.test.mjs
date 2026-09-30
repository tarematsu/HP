import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { publishRecentDailySummaries } from '../worker/src/recent-daily-summary-publication.js';

const DAY_MS = 86_400_000;

function d1(db) {
  return {
    prepare(sql) {
      const statement = db.prepare(sql);
      let values = [];
      return {
        bind(...next) {
          values = next;
          return this;
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async run() {
          const result = statement.run(...values);
          return { meta: { changes: Number(result.changes || 0) } };
        },
      };
    },
  };
}

function createMinuteDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_current_daily_summary(
    channel_id INTEGER NOT NULL,
    day_at INTEGER NOT NULL,
    period_start INTEGER NOT NULL,
    period_end INTEGER NOT NULL,
    sample_count INTEGER NOT NULL,
    reliable_sample_count INTEGER NOT NULL,
    listener_sum REAL NOT NULL,
    listener_min INTEGER,
    listener_max INTEGER,
    stream_start INTEGER,
    stream_end INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(channel_id,day_at)
  ) WITHOUT ROWID;
  CREATE TABLE sh_total_member_daily(
    channel_id INTEGER NOT NULL,
    day_at INTEGER NOT NULL,
    host_key INTEGER NOT NULL,
    last_observed_at INTEGER NOT NULL,
    last_total_member_count INTEGER,
    PRIMARY KEY(channel_id,day_at,host_key)
  ) WITHOUT ROWID;
  CREATE INDEX idx_sh_total_member_daily_latest
    ON sh_total_member_daily(
      channel_id,day_at,last_observed_at DESC,host_key,last_total_member_count
    );`);
  return db;
}

function createOtherDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_daily_summary(
    period_key TEXT PRIMARY KEY,
    period_start INTEGER,period_end INTEGER,
    sample_count INTEGER,reliable_sample_count INTEGER,
    listener_avg REAL,listener_min INTEGER,listener_max INTEGER,
    stream_start INTEGER,stream_end INTEGER,stream_growth INTEGER,
    member_start INTEGER,member_end INTEGER,member_growth INTEGER,
    likes_max INTEGER,distinct_tracks INTEGER,primary_host TEXT,
    quality_score REAL,quality_flags TEXT,updated_at INTEGER
  );`);
  return db;
}

test('recent publication repairs missing metrics and widens incomplete day boundaries', async () => {
  const minute = createMinuteDb();
  const other = createOtherDb();
  const day = Date.UTC(2026, 8, 29);
  const now = Date.UTC(2026, 8, 30, 3, 0);

  minute.prepare(`INSERT INTO sh_current_daily_summary VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    1,
    day,
    day,
    day + DAY_MS - 300_000,
    288,
    288,
    28_800,
    80,
    125,
    50_000,
    50_321,
    day + DAY_MS - 300_000,
  );

  other.prepare(`INSERT INTO sh_daily_summary(
    period_key,period_start,period_end,sample_count,reliable_sample_count,
    listener_avg,listener_min,listener_max,stream_start,stream_end,stream_growth,
    quality_flags,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    '2026-09-29',
    day + 20 * 60_000,
    day + DAY_MS - 20 * 60_000,
    288,
    288,
    null,
    null,
    null,
    null,
    null,
    null,
    '["existing"]',
    1,
  );

  const result = await publishRecentDailySummaries(d1(minute), d1(other), now, 1);
  assert.deepEqual(result.published, ['2026-09-29']);

  const row = other.prepare(`SELECT period_start,period_end,listener_avg,listener_min,listener_max,
    stream_start,stream_end,stream_growth,quality_flags
    FROM sh_daily_summary WHERE period_key='2026-09-29'`).get();
  assert.equal(Number(row.period_start), day);
  assert.equal(Number(row.period_end), day + DAY_MS - 300_000);
  assert.equal(Number(row.listener_avg), 100);
  assert.equal(Number(row.listener_min), 80);
  assert.equal(Number(row.listener_max), 125);
  assert.equal(Number(row.stream_start), 50_000);
  assert.equal(Number(row.stream_end), 50_321);
  assert.equal(Number(row.stream_growth), 321);
  assert.equal(row.quality_flags, '["existing"]');
});
