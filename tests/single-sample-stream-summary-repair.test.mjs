import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { repairSingleSampleStreamSummaries } from '../worker/scripts/repair-single-sample-stream-summaries.mjs';

function adapter(db) {
  return { prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async first() { return db.prepare(sql).get(...args) ?? null; },
      async run() { return db.prepare(sql).run(...args); },
    };
  } };
}

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_daily_summary(
      period_key TEXT PRIMARY KEY,sample_count INTEGER,stream_start INTEGER,stream_end INTEGER,
      stream_growth INTEGER,quality_flags TEXT DEFAULT '[]',updated_at INTEGER DEFAULT 1);
    CREATE TABLE sh_weekly_summary(
      period_key TEXT PRIMARY KEY,stream_start INTEGER,stream_end INTEGER,stream_growth INTEGER,
      quality_flags TEXT DEFAULT '[]',updated_at INTEGER DEFAULT 1);
    CREATE TABLE sh_monthly_summary(
      period_key TEXT PRIMARY KEY,stream_start INTEGER,stream_end INTEGER,stream_growth INTEGER,
      quality_flags TEXT DEFAULT '[]',updated_at INTEGER DEFAULT 1);`);
  const day = (key, samples, start, end = start, flags = '[]') => db.prepare(
    'INSERT INTO sh_daily_summary(period_key,sample_count,stream_start,stream_end,stream_growth,quality_flags) VALUES(?,?,?,?,?,?)',
  ).run(key, samples, start, end, start != null && end != null && end >= start ? end - start : null, flags);
  const parent = (mode, key, start, end) => db.prepare(
    `INSERT INTO sh_${mode}_summary(period_key,stream_start,stream_end,stream_growth) VALUES(?,?,?,?)`,
  ).run(key, start, end, end >= start ? end - start : null);
  const run = () => repairSingleSampleStreamSummaries({ otherDb: adapter(db), now: Date.parse('2026-09-23T00:00:00Z') });
  const get = (key) => db.prepare('SELECT * FROM sh_daily_summary WHERE period_key=?').get(key);
  return { db, day, parent, run, get };
}

test('repairs the known 2024 range from the next day opening value and rebuilds parents', async () => {
  const f = fixture();
  f.day('2024-09-01', 20, 90, 100);
  f.day('2024-09-02', 20, 100);
  f.day('2024-09-03', 20, 130);
  f.day('2024-09-30', 20, 200);
  f.day('2024-10-01', 20, 240);
  f.parent('weekly', '2024-09-02', 100, 130);
  f.parent('monthly', '2024-09', 100, 200);

  const result = await f.run();
  assert.deepEqual(
    [f.get('2024-09-02').stream_start, f.get('2024-09-02').stream_end, f.get('2024-09-02').stream_growth],
    [100, 130, 30],
  );
  assert.deepEqual(
    [f.get('2024-09-30').stream_start, f.get('2024-09-30').stream_end, f.get('2024-09-30').stream_growth],
    [200, 240, 40],
  );
  assert.match(f.get('2024-09-02').quality_flags, /stream_end_next_day_start_single_sample_v1/);
  assert.deepEqual(result.daily.map((row) => row.key), ['2024-09-02', '2024-09-30']);
  assert.equal(f.db.prepare("SELECT stream_end FROM sh_monthly_summary WHERE period_key='2024-09'").get().stream_end, 240);
});

test('known historical ranges overwrite recorded closing values with next-day openings', async () => {
  const f = fixture();
  f.day('2024-09-18', 20, 2973508, 3000000);
  f.day('2024-09-19', 20, 3023102, 3023102, '["stream_end_next_day_start_single_sample_v1"]');
  f.day('2025-08-31', 30, 27800000, 27850000);
  f.day('2025-09-01', 30, 27860000, 27900000);
  f.day('2025-09-02', 30, 27950000, 28000000);
  f.day('2025-09-30', 30, 32000000, 32050000);
  f.day('2025-10-01', 30, 32120000, 32150000);
  f.parent('weekly', '2025-08-25', 27400000, 27850000);
  f.parent('monthly', '2025-08', 27400000, 27850000);
  f.parent('monthly', '2025-09', 27860000, 32050000);

  const result = await f.run();
  assert.deepEqual(
    [f.get('2024-09-18').stream_end, f.get('2024-09-18').stream_growth],
    [3023102, 49594],
  );
  assert.deepEqual(
    [f.get('2025-08-31').stream_end, f.get('2025-08-31').stream_growth],
    [27860000, 60000],
  );
  assert.deepEqual(
    [f.get('2025-09-01').stream_end, f.get('2025-09-01').stream_growth],
    [27950000, 90000],
  );
  assert.deepEqual(
    [f.get('2025-09-30').stream_end, f.get('2025-09-30').stream_growth],
    [32120000, 120000],
  );
  assert.equal(f.db.prepare("SELECT stream_end FROM sh_weekly_summary WHERE period_key='2025-08-25'").get().stream_end, 27860000);
  assert.equal(f.db.prepare("SELECT stream_end FROM sh_monthly_summary WHERE period_key='2025-08'").get().stream_end, 27860000);
  assert.equal(f.db.prepare("SELECT stream_end FROM sh_monthly_summary WHERE period_key='2025-09'").get().stream_end, 32120000);
  assert.deepEqual(result.daily.map((row) => row.key), ['2024-09-18', '2025-08-31', '2025-09-01', '2025-09-30']);
});

test('repairs matching one-sample days outside the known range but leaves multi-sample days alone', async () => {
  const f = fixture();
  f.day('2025-01-10', 1, 500);
  f.day('2025-01-11', 1, 540);
  f.day('2025-01-12', 30, 600);
  f.day('2025-01-13', 30, 660);

  const result = await f.run();
  assert.equal(f.get('2025-01-10').stream_end, 540);
  assert.equal(f.get('2025-01-10').stream_growth, 40);
  assert.equal(f.get('2025-01-12').stream_end, 600);
  assert.deepEqual(result.daily.map((row) => row.key), ['2025-01-10', '2025-01-11']);
});

test('rejects counter resets and borrowed next-day starts, and is idempotent', async () => {
  const f = fixture();
  f.day('2025-02-01', 1, 900);
  f.day('2025-02-02', 1, 800);
  f.day('2025-02-03', 1, 1000);
  f.day('2025-02-04', 1, 1100, 1100, '["stream_start_previous_day_end"]');

  const first = await f.run();
  assert.equal(f.get('2025-02-01').stream_end, 900);
  assert.equal(f.get('2025-02-03').stream_end, 1000);
  assert.deepEqual(first.daily.map((row) => row.key), ['2025-02-02']);
  const second = await f.run();
  assert.equal(second.daily.length, 0);
});
