import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  EXISTING_RECENT_DAILY_SQL,
  RECENT_DAILY_MEMBER_SQL,
  RECENT_DAILY_PROJECTION_SQL,
  publishRecentDailySummaries,
} from '../worker/src/recent-daily-summary-publication.js';

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
        async first() {
          return statement.get(...values) || null;
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

function insertProjection(db, dayAt, {
  channelId = 1,
  samples = 10,
  reliable = 10,
  listenerSum = 1000,
  listenerMin = 80,
  listenerMax = 120,
  streamStart = 1000,
  streamEnd = 1010,
} = {}) {
  db.prepare(`INSERT INTO sh_current_daily_summary VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    channelId,
    dayAt,
    dayAt,
    dayAt + DAY_MS - 60_000,
    samples,
    reliable,
    listenerSum,
    listenerMin,
    listenerMax,
    streamStart,
    streamEnd,
    dayAt + DAY_MS - 60_000,
  );
}

function insertDailyMember(db, dayAt, count, {
  channelId = 1,
  hostKey = 0,
  observedAt = dayAt + DAY_MS - 60_000,
} = {}) {
  db.prepare(`INSERT INTO sh_total_member_daily(
    channel_id,day_at,host_key,last_observed_at,last_total_member_count
  ) VALUES(?,?,?,?,?)`).run(channelId, dayAt, hostKey, observedAt, count);
}

test('recent daily publication reads projection metrics and canonical daily member state separately', () => {
  assert.match(RECENT_DAILY_PROJECTION_SQL, /FROM sh_current_daily_summary/);
  assert.match(RECENT_DAILY_PROJECTION_SQL, /WHERE day_at>=\? AND day_at<\?/);
  assert.doesNotMatch(RECENT_DAILY_PROJECTION_SQL, /FROM sh_minute_facts/);
  assert.doesNotMatch(RECENT_DAILY_PROJECTION_SQL, /member_end/);
  assert.match(RECENT_DAILY_MEMBER_SQL, /FROM sh_total_member_daily/);
  assert.match(RECENT_DAILY_MEMBER_SQL, /INDEXED BY idx_sh_total_member_daily_latest/);
  assert.match(RECENT_DAILY_MEMBER_SQL, /WHERE channel_id=\? AND day_at>=\? AND day_at<\?/);
  assert.match(EXISTING_RECENT_DAILY_SQL, /FROM sh_daily_summary/);
});

test('missing recent days use canonical member state without overwriting unrelated fields', async () => {
  const minute = createMinuteDb();
  const other = createOtherDb();
  const now = Date.UTC(2026, 8, 27, 3, 0);
  const sep22 = Date.UTC(2026, 8, 22);
  const sep23 = Date.UTC(2026, 8, 23);
  const sep24 = Date.UTC(2026, 8, 24);
  const sep25 = Date.UTC(2026, 8, 25);
  const sep26 = Date.UTC(2026, 8, 26);

  other.prepare(`INSERT INTO sh_daily_summary(
    period_key,member_end,quality_flags,updated_at
  ) VALUES('2026-09-22',98,'["existing"]',1)`).run();
  insertProjection(minute, sep23, { streamStart: 2000, streamEnd: 2015 });
  insertProjection(minute, sep24, { streamStart: 2015, streamEnd: 2035, listenerSum: 950 });
  insertProjection(minute, sep25, { streamStart: 2035, streamEnd: 2040, reliable: 5, listenerSum: 425 });
  insertProjection(minute, sep26, { streamStart: 2040, streamEnd: 2060 });
  insertDailyMember(minute, sep22, 98);
  insertDailyMember(minute, sep23, 100);
  insertDailyMember(minute, sep24, 103);
  insertDailyMember(minute, sep25, 104);
  insertDailyMember(minute, sep26, 106);

  const result = await publishRecentDailySummaries(d1(minute), d1(other), now, 4);
  assert.deepEqual(result.published, ['2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
  assert.deepEqual(result.unavailable, []);
  assert.deepEqual(result.invalid, []);

  const rows = other.prepare(`SELECT period_key,listener_avg,stream_growth,member_start,member_end,member_growth,quality_flags
    FROM sh_daily_summary WHERE period_key>='2026-09-23' ORDER BY period_key`).all();
  assert.equal(rows.length, 4);
  assert.equal(Number(rows[0].member_start), 98);
  assert.equal(Number(rows[0].member_end), 100);
  assert.equal(Number(rows[0].member_growth), 2);
  assert.equal(Number(rows[0].stream_growth), 15);
  assert.equal(Number(rows[1].member_start), 100);
  assert.equal(Number(rows[1].member_growth), 3);
  assert.equal(Number(rows[2].listener_avg), 85);
  assert.equal(rows[0].quality_flags, '["daily_projection_publish"]');

  other.prepare(`UPDATE sh_daily_summary SET stream_growth=999 WHERE period_key='2026-09-24'`).run();
  const second = await publishRecentDailySummaries(d1(minute), d1(other), now, 4);
  assert.deepEqual(second.published, []);
  assert.equal(other.prepare(`SELECT stream_growth FROM sh_daily_summary WHERE period_key='2026-09-24'`).get().stream_growth, 999);
});

test('daily member state supplies member boundaries independently of the projection', async () => {
  const minute = createMinuteDb();
  const other = createOtherDb();
  const now = Date.UTC(2026, 8, 25, 3, 0);
  const sep22 = Date.UTC(2026, 8, 22);
  const sep23 = Date.UTC(2026, 8, 23);
  const sep24 = Date.UTC(2026, 8, 24);

  insertProjection(minute, sep23, { streamStart: 3000, streamEnd: 3010 });
  insertProjection(minute, sep24, { streamStart: 3010, streamEnd: 3025 });
  insertDailyMember(minute, sep22, 98);
  insertDailyMember(minute, sep23, 100);
  insertDailyMember(minute, sep24, 103);

  const result = await publishRecentDailySummaries(d1(minute), d1(other), now, 2);
  assert.deepEqual(result.published, ['2026-09-23', '2026-09-24']);

  const rows = other.prepare(`SELECT period_key,member_start,member_end,member_growth
    FROM sh_daily_summary ORDER BY period_key`).all();
  assert.deepEqual(rows.map((row) => ({
    period_key: row.period_key,
    member_start: Number(row.member_start),
    member_end: Number(row.member_end),
    member_growth: Number(row.member_growth),
  })), [
    { period_key: '2026-09-23', member_start: 98, member_end: 100, member_growth: 2 },
    { period_key: '2026-09-24', member_start: 100, member_end: 103, member_growth: 3 },
  ]);
});

test('latest daily member state wins when more than one host row exists for a day', async () => {
  const minute = createMinuteDb();
  const other = createOtherDb();
  const now = Date.UTC(2026, 8, 24, 3, 0);
  const sep22 = Date.UTC(2026, 8, 22);
  const sep23 = Date.UTC(2026, 8, 23);

  insertProjection(minute, sep23);
  insertDailyMember(minute, sep22, 98);
  insertDailyMember(minute, sep23, 100, { hostKey: 1, observedAt: sep23 + 10_000 });
  insertDailyMember(minute, sep23, 101, { hostKey: 2, observedAt: sep23 + 20_000 });

  const result = await publishRecentDailySummaries(d1(minute), d1(other), now, 1);
  assert.deepEqual(result.published, ['2026-09-23']);
  const row = other.prepare(`SELECT member_start,member_end,member_growth FROM sh_daily_summary
    WHERE period_key='2026-09-23'`).get();
  assert.equal(Number(row.member_start), 98);
  assert.equal(Number(row.member_end), 101);
  assert.equal(Number(row.member_growth), 3);
});

test('existing recent days reconcile canonical member values while preserving other summary fields', async () => {
  const minute = createMinuteDb();
  const other = createOtherDb();
  const now = Date.UTC(2026, 8, 25, 3, 0);
  const sep22 = Date.UTC(2026, 8, 22);
  const sep23 = Date.UTC(2026, 8, 23);
  const sep24 = Date.UTC(2026, 8, 24);

  other.prepare(`INSERT INTO sh_daily_summary(
    period_key,listener_avg,stream_growth,member_end,quality_flags,updated_at
  ) VALUES('2026-09-22',222,666,98,'["existing"]',1)`).run();
  other.prepare(`INSERT INTO sh_daily_summary(
    period_key,listener_avg,stream_growth,member_start,member_end,member_growth,quality_flags,updated_at
  ) VALUES('2026-09-23',321,777,98,NULL,NULL,'["existing"]',1)`).run();
  other.prepare(`INSERT INTO sh_daily_summary(
    period_key,listener_avg,stream_growth,member_start,member_end,member_growth,quality_flags,updated_at
  ) VALUES('2026-09-24',432,888,100,103,3,'["existing"]',1)`).run();

  insertProjection(minute, sep23, { streamStart: 3000, streamEnd: 3010 });
  insertProjection(minute, sep24, { streamStart: 3010, streamEnd: 3020 });
  insertDailyMember(minute, sep22, 98);
  insertDailyMember(minute, sep23, 100);
  insertDailyMember(minute, sep24, 102);

  const result = await publishRecentDailySummaries(d1(minute), d1(other), now, 2);
  assert.deepEqual(result.published, ['2026-09-23', '2026-09-24']);
  assert.deepEqual(result.unavailable, []);
  assert.deepEqual(result.invalid, []);

  const rows = other.prepare(`SELECT period_key,listener_avg,stream_growth,member_start,member_end,member_growth,quality_flags
    FROM sh_daily_summary WHERE period_key>='2026-09-23' ORDER BY period_key`).all();
  assert.equal(rows.length, 2);
  assert.equal(Number(rows[0].listener_avg), 321);
  assert.equal(Number(rows[0].stream_growth), 777);
  assert.equal(Number(rows[0].member_start), 98);
  assert.equal(Number(rows[0].member_end), 100);
  assert.equal(Number(rows[0].member_growth), 2);
  assert.equal(rows[0].quality_flags, '["existing"]');
  assert.equal(Number(rows[1].listener_avg), 432);
  assert.equal(Number(rows[1].stream_growth), 888);
  assert.equal(Number(rows[1].member_start), 100);
  assert.equal(Number(rows[1].member_end), 102);
  assert.equal(Number(rows[1].member_growth), 2);
  assert.equal(rows[1].quality_flags, '["existing"]');

  const second = await publishRecentDailySummaries(d1(minute), d1(other), now, 2);
  assert.deepEqual(second.published, []);
});

test('missing canonical member state does not overwrite an existing derived boundary', async () => {
  const minute = createMinuteDb();
  const other = createOtherDb();
  const now = Date.UTC(2026, 8, 24, 3, 0);
  const sep23 = Date.UTC(2026, 8, 23);

  insertProjection(minute, sep23);
  other.prepare(`INSERT INTO sh_daily_summary(
    period_key,member_start,member_end,member_growth,quality_flags,updated_at
  ) VALUES('2026-09-23',98,100,2,'["existing"]',1)`).run();

  const result = await publishRecentDailySummaries(d1(minute), d1(other), now, 1);
  assert.deepEqual(result.published, []);
  const row = other.prepare(`SELECT member_start,member_end,member_growth FROM sh_daily_summary
    WHERE period_key='2026-09-23'`).get();
  assert.deepEqual(row, { member_start: 98, member_end: 100, member_growth: 2 });
});

test('invalid projection counts are refused instead of publishing a corrupt daily row', async () => {
  const minute = createMinuteDb();
  const other = createOtherDb();
  const now = Date.UTC(2026, 8, 27, 3, 0);
  const sep26 = Date.UTC(2026, 8, 26);
  insertProjection(minute, sep26, { samples: 1500, reliable: 1500 });

  const result = await publishRecentDailySummaries(d1(minute), d1(other), now, 1);
  assert.deepEqual(result.published, []);
  assert.deepEqual(result.invalid, ['2026-09-26']);
  assert.equal(other.prepare('SELECT COUNT(*) AS count FROM sh_daily_summary').get().count, 0);
});
