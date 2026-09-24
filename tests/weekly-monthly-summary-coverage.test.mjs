import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { loadMaterializedSummary } from '../site/functions/lib/materialized-history.js';
import { applySummaryCompleteness, expectedPeriodBounds } from '../site/functions/lib/period-completeness.js';

const DAY = 86_400_000;
const MINUTE = 60_000;
const NOW = Date.parse('2026-09-22T12:00:00Z');

function setup(mode, key) {
  const db = new DatabaseSync(':memory:');
  for (const table of ['daily', 'weekly']) db.exec(`CREATE TABLE sh_${table}_summary(
    period_key TEXT PRIMARY KEY,period_start INTEGER,period_end INTEGER,
    sample_count INTEGER,reliable_sample_count INTEGER,listener_avg REAL,
    listener_min INTEGER,listener_max INTEGER,stream_start INTEGER,stream_end INTEGER,
    stream_growth INTEGER,member_start INTEGER,member_end INTEGER,member_growth INTEGER,
    likes_max INTEGER,distinct_tracks INTEGER,primary_host TEXT,quality_score REAL,quality_flags TEXT);`);
  const bounds = expectedPeriodBounds(mode, key);
  const parent = [key, bounds.start, bounds.end - MINUTE, 10080, 10080, 125, 100, 140,
    1000, 2000, 1000, 300, 310, 10, null, 1, 'host', 1, '["weekly_reconciled"]'];
  db.prepare(`INSERT INTO sh_${mode}_summary VALUES(${parent.map(() => '?').join(',')})`).run(...parent);
  for (let at = bounds.start; at < bounds.end; at += DAY) {
    const day = new Date(at).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO sh_daily_summary VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      day, at + MINUTE, at + DAY - MINUTE, 1440, 1440, 125, 100, 140,
      1000, 2000, 1000, 300, 310, 10, null, null, 'host', 1, '["daily_reconciled"]');
  }
  const adapter = {
    prepare(sql) {
      let binds = [];
      return {
        bind(...values) { binds = values; return this; },
        async all() { return { results: db.prepare(sql).all(...binds) }; },
        async run() { return db.prepare(sql).run(...binds); },
      };
    },
  };
  const get = () => loadMaterializedSummary({ OTHER_DB: adapter }, mode, key, key, NOW);
  return { db, bounds, get };
}

function periodDays(bounds) {
  return Math.round((bounds.end - bounds.start) / DAY);
}

for (const [mode, key] of [['weekly', '2026-09-07']]) {
  test(`${mode} keeps all metrics when listener coverage and boundaries are complete`, async () => {
    const f = setup(mode, key);
    const row = (await f.get()).rows[0];
    assert.equal(row.listener_avg, 125);
    assert.equal(row.listener_min, 100);
    assert.equal(row.listener_max, 140);
    assert.equal(row.stream_start, 1000);
    assert.equal(row.stream_end, 2000);
    assert.equal(row.stream_growth, 1000);
    assert.equal(row.period_complete, true);
  });

  test(`${mode} treats full 5-minute collection as complete listener coverage`, async () => {
    const f = setup(mode, key);
    f.db.exec(`UPDATE sh_daily_summary
      SET period_start=period_start+240000,period_end=period_end-240000,
          sample_count=288,reliable_sample_count=288`);
    const row = (await f.get()).rows[0];
    assert.equal(row.listener_avg, 125);
    assert.equal(row.listener_min, 100);
    assert.equal(row.listener_max, 140);
  });

  test(`${mode} keeps listener and stream metrics when one internal day is absent`, async () => {
    const f = setup(mode, key);
    const missing = new Date(f.bounds.start + 3 * DAY).toISOString().slice(0, 10);
    f.db.prepare('DELETE FROM sh_daily_summary WHERE period_key=?').run(missing);
    const row = (await f.get()).rows[0];
    assert.equal(row.period_complete, false);
    assert.equal(row.listener_avg, 125);
    assert.equal(row.listener_min, 100);
    assert.equal(row.listener_max, 140);
    assert.equal(row.stream_start, 1000);
    assert.equal(row.stream_end, 2000);
    assert.equal(row.stream_growth, 1000);
    assert.ok(row.exclusion_reasons.includes('missing_daily_coverage'));
  });

  test(`${mode} keeps listener average regardless of listener coverage`, async () => {
    const f = setup(mode, key);
    const days = periodDays(f.bounds);
    const deleteCount = Math.ceil(days / 2);
    for (let index = 0; index < deleteCount; index += 1) {
      const day = new Date(f.bounds.start + index * DAY).toISOString().slice(0, 10);
      f.db.prepare('DELETE FROM sh_daily_summary WHERE period_key=?').run(day);
    }
    const row = (await f.get()).rows[0];
    assert.equal(row.listener_avg, 125);
    assert.equal(row.listener_min, 100);
    assert.equal(row.listener_max, 140);
    assert.equal(row.stream_start, 1000);
    assert.equal(row.stream_end, 2000);
    assert.equal(row.stream_growth, 1000);
    assert.equal(row.listener_average_excluded, false);
    assert.ok(row.exclusion_reasons.includes('missing_daily_coverage'));
    assert.ok(!row.exclusion_reasons.includes('insufficient_listener_coverage'));
  });

  test(`${mode} keeps one available stream boundary and suppresses only growth`, async () => {
    const f = setup(mode, key);
    f.db.prepare(`UPDATE sh_${mode}_summary SET stream_start=NULL WHERE period_key=?`).run(key);
    const row = (await f.get()).rows[0];
    assert.equal(row.listener_avg, 125);
    assert.equal(row.listener_min, 100);
    assert.equal(row.listener_max, 140);
    assert.equal(row.stream_start, null);
    assert.equal(row.stream_end, 2000);
    assert.equal(row.stream_growth, null);
    assert.equal(row.stream_growth_excluded, true);
  });

  test(`${mode} keeps member boundaries on their wider tolerance while stream stays on five percent`, () => {
    const f = setup(mode, key);
    const span = f.bounds.end - f.bounds.start;
    const daily = f.db.prepare('SELECT * FROM sh_daily_summary ORDER BY period_key').all();
    const row = applySummaryCompleteness([{
      period_key: key,
      period_start: f.bounds.start,
      period_end: f.bounds.end,
      boundary_start_at: f.bounds.start + span * 0.05 + 1,
      boundary_end_at: f.bounds.end - span * 0.05,
      sample_count: 10080,
      reliable_sample_count: 10080,
      listener_avg: 125,
      listener_min: 100,
      listener_max: 140,
      stream_start: 1000,
      stream_end: 2000,
      member_start: 300,
      member_end: 310,
      quality_flags: '[]',
    }], mode, NOW, daily).rows[0];
    assert.equal(row.listener_avg, 125);
    assert.equal(row.stream_start, null);
    assert.equal(row.stream_end, 2000);
    assert.equal(row.stream_growth, null);
    assert.equal(row.member_start, 300);
    assert.equal(row.member_end, 310);
    assert.equal(row.member_growth, 10);
  });
}

test('trusted archived email recap remains independent of daily minute coverage', () => {
  const bounds = expectedPeriodBounds('weekly', '2026-06-22');
  const row = {
    period_key: '2026-06-22', period_start: bounds.start, period_end: bounds.end,
    listener_avg: 120, stream_start: 100, stream_end: 200, stream_growth: 100,
    quality_flags: '["stationhead_email_recap"]',
  };
  const result = applySummaryCompleteness([row], 'weekly', NOW, []).rows[0];
  assert.equal(result.stream_growth, 100);
  assert.equal(result.listener_avg, 120);
});
