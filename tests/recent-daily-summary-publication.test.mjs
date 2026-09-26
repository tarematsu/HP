import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  EXISTING_RECENT_DAILY_SQL,
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
    member_end INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(channel_id,day_at)
  ) WITHOUT ROWID;`);
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
  memberEnd = 100,
} = {}) {
  db.prepare(`INSERT INTO sh_current_daily_summary VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
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
    memberEnd,
    dayAt + DAY_MS - 60_000,
  );
}

test('recent daily publication reads only completed projection rows and existing summaries', () => {
  assert.match(RECENT_DAILY_PROJECTION_SQL, /FROM sh_current_daily_summary/);
  assert.match(RECENT_DAILY_PROJECTION_SQL, /WHERE day_at>=\? AND day_at<\?/);
  assert.doesNotMatch(RECENT_DAILY_PROJECTION_SQL, /FROM sh_minute_facts/);
  assert.match(EXISTING_RECENT_DAILY_SQL, /FROM sh_daily_summary/);
});

test('missing recent days are copied from the incremental projection without overwriting existing rows', async () => {
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
  insertProjection(minute, sep23, { memberEnd: 100, streamStart: 2000, streamEnd: 2015 });
  insertProjection(minute, sep24, { memberEnd: 103, streamStart: 2015, streamEnd: 2035, listenerSum: 950 });
  insertProjection(minute, sep25, { memberEnd: 104, streamStart: 2035, streamEnd: 2040, reliable: 5, listenerSum: 425 });
  insertProjection(minute, sep26, { memberEnd: 106, streamStart: 2040, streamEnd: 2060 });

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
