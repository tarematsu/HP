import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { repairHistoricalStreamBoundaries } from '../worker/scripts/repair-historical-stream-boundaries.mjs';

const DAY = 86_400_000;
const ts = (iso) => Date.parse(iso);

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
      period_key TEXT PRIMARY KEY,period_start INTEGER,period_end INTEGER,
      stream_start INTEGER,stream_end INTEGER,stream_growth INTEGER,
      quality_flags TEXT DEFAULT '[]',updated_at INTEGER DEFAULT 1);
    CREATE TABLE sh_weekly_summary(
      period_key TEXT PRIMARY KEY,stream_start INTEGER,stream_end INTEGER,stream_growth INTEGER,
      quality_flags TEXT DEFAULT '[]',updated_at INTEGER DEFAULT 1);
    CREATE TABLE sh_monthly_summary(
      period_key TEXT PRIMARY KEY,stream_start INTEGER,stream_end INTEGER,stream_growth INTEGER,
      quality_flags TEXT DEFAULT '[]',updated_at INTEGER DEFAULT 1);`);
  const day = (key, startAt, endAt, startValue, endValue) => db.prepare(
    `INSERT INTO sh_daily_summary(
      period_key,period_start,period_end,stream_start,stream_end,stream_growth
    ) VALUES(?,?,?,?,?,?)`,
  ).run(key, startAt, endAt, startValue, endValue,
    endValue >= startValue ? endValue - startValue : null);
  const parent = (mode, key, start, end) => db.prepare(
    `INSERT INTO sh_${mode}_summary(period_key,stream_start,stream_end,stream_growth) VALUES(?,?,?,?)`,
  ).run(key, start, end, end >= start ? end - start : null);
  const getDay = (key) => db.prepare('SELECT * FROM sh_daily_summary WHERE period_key=?').get(key);
  return { db, day, parent, getDay, otherDb: adapter(db) };
}

test('linearly interpolates missing UTC midnight boundaries from the adjacent observations', async () => {
  const f = fixture();
  f.day('2024-06-27', ts('2024-06-27T00:10:00Z'), ts('2024-06-27T23:50:00Z'), 20, 100);
  f.day('2024-06-28', ts('2024-06-28T00:10:00Z'), ts('2024-06-28T23:45:00Z'), 120, 200);
  f.day('2024-06-29', ts('2024-06-29T00:15:00Z'), ts('2024-06-29T23:30:00Z'), 240, 300);
  f.day('2024-06-30', ts('2024-06-30T00:30:00Z'), ts('2024-06-30T23:50:00Z'), 360, 400);

  const result = await repairHistoricalStreamBoundaries({
    otherDb: f.otherDb,
    now: ts('2026-09-24T00:00:00Z'),
    ranges: [{ start: '2024-06-28', end: '2024-06-29', reason: 'test' }],
  });

  assert.deepEqual(
    [f.getDay('2024-06-28').stream_start, f.getDay('2024-06-28').stream_end, f.getDay('2024-06-28').stream_growth],
    [110, 220, 110],
  );
  assert.deepEqual(
    [f.getDay('2024-06-29').stream_start, f.getDay('2024-06-29').stream_end, f.getDay('2024-06-29').stream_growth],
    [220, 330, 110],
  );
  assert.match(f.getDay('2024-06-28').quality_flags, /stream_boundary_interpolated_v1/);
  assert.deepEqual(result.daily.map((row) => row.key), ['2024-06-28', '2024-06-29']);
  assert.equal(result.daily[0].start_evidence.gap_ms, 20 * 60_000);
});

test('recomputes weekly and monthly stream boundaries that depend on a repaired day', async () => {
  const f = fixture();
  f.day('2024-06-01', ts('2024-06-01T00:00:00Z'), ts('2024-06-01T23:50:00Z'), 50, 80);
  f.day('2024-06-24', ts('2024-06-24T00:00:00Z'), ts('2024-06-24T23:50:00Z'), 100, 130);
  f.day('2024-06-29', ts('2024-06-29T00:10:00Z'), ts('2024-06-29T23:50:00Z'), 180, 200);
  f.day('2024-06-30', ts('2024-06-30T00:10:00Z'), ts('2024-06-30T23:50:00Z'), 220, 300);
  f.day('2024-07-01', ts('2024-07-01T00:10:00Z'), ts('2024-07-01T23:50:00Z'), 340, 380);
  f.parent('weekly', '2024-06-24', 100, 300);
  f.parent('monthly', '2024-06', 50, 300);

  const result = await repairHistoricalStreamBoundaries({
    otherDb: f.otherDb,
    now: ts('2026-09-24T00:00:00Z'),
    ranges: [{ start: '2024-06-30', end: '2024-06-30', reason: 'test' }],
  });

  assert.deepEqual(
    [f.getDay('2024-06-30').stream_start, f.getDay('2024-06-30').stream_end, f.getDay('2024-06-30').stream_growth],
    [210, 320, 110],
  );
  const weekly = f.db.prepare("SELECT stream_start,stream_end,stream_growth,quality_flags FROM sh_weekly_summary WHERE period_key='2024-06-24'").get();
  const monthly = f.db.prepare("SELECT stream_start,stream_end,stream_growth,quality_flags FROM sh_monthly_summary WHERE period_key='2024-06'").get();
  assert.deepEqual([weekly.stream_start, weekly.stream_end, weekly.stream_growth], [100, 320, 220]);
  assert.deepEqual([monthly.stream_start, monthly.stream_end, monthly.stream_growth], [50, 320, 270]);
  assert.match(weekly.quality_flags, /stream_boundary_interpolated_v1/);
  assert.match(monthly.quality_flags, /stream_boundary_interpolated_v1/);
  assert.deepEqual(result.weekly.map((row) => row.key), ['2024-06-24']);
  assert.deepEqual(result.monthly.map((row) => row.key), ['2024-06']);
});

test('refuses interpolation across counter decreases or overly wide observation gaps', async () => {
  const f = fixture();
  f.day('2024-06-27', ts('2024-06-27T00:00:00Z'), ts('2024-06-27T23:50:00Z'), 100, 200);
  f.day('2024-06-28', ts('2024-06-28T00:10:00Z'), ts('2024-06-28T23:50:00Z'), 190, 250);
  f.day('2024-06-29', ts('2024-06-29T20:00:00Z'), ts('2024-06-29T23:50:00Z'), 400, 430);

  const original = f.getDay('2024-06-28');
  const result = await repairHistoricalStreamBoundaries({
    otherDb: f.otherDb,
    now: ts('2026-09-24T00:00:00Z'),
    ranges: [{ start: '2024-06-28', end: '2024-06-28', reason: 'test' }],
    maxGapMs: 12 * 60 * 60 * 1000,
  });

  const repaired = f.getDay('2024-06-28');
  assert.deepEqual(
    [repaired.stream_start, repaired.stream_end, repaired.stream_growth],
    [original.stream_start, original.stream_end, original.stream_growth],
  );
  assert.equal(result.daily.length, 0);
  assert.ok(result.skipped.some((row) => row.reason === 'stream_counter_decrease'));
  assert.ok(result.skipped.some((row) => row.reason === 'boundary_gap_too_wide' || row.reason === 'daily_boundary_pair_unavailable'));
});
