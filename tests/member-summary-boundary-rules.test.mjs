import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  applySummaryCompleteness,
  expectedPeriodBounds,
  memberBoundaryToleranceMs,
} from '../site/functions/lib/period-completeness.js';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-23T00:00:00Z');

function summaryRow(mode, key, overrides = {}) {
  const bounds = expectedPeriodBounds(mode, key);
  const sampleCount = mode === 'daily' ? 1440 : mode === 'weekly' ? 2016 : 8928;
  return {
    period_key: key,
    period_start: bounds.start,
    period_end: bounds.end,
    sample_count: sampleCount,
    reliable_sample_count: sampleCount,
    listener_avg: 125,
    listener_min: 100,
    listener_max: 140,
    stream_start: 1000,
    stream_end: 2000,
    stream_growth: 1000,
    member_start: 300,
    member_end: 310,
    member_growth: 10,
    quality_flags: '[]',
    ...overrides,
  };
}

function memberDay(key, memberStart = null, memberEnd = null) {
  return {
    period_key: key,
    period_start: Date.parse(`${key}T00:01:00Z`),
    period_end: Date.parse(`${key}T23:59:00Z`),
    sample_count: 288,
    reliable_sample_count: 288,
    member_start: memberStart,
    member_end: memberEnd,
  };
}

test('daily keeps previous-day member start but suppresses growth when the current end is missing', () => {
  const bounds = expectedPeriodBounds('daily', '2026-09-20');
  const row = applySummaryCompleteness([summaryRow('daily', '2026-09-20', {
    period_start: bounds.start,
    period_end: bounds.end,
    member_start: 300,
    member_end: null,
    member_growth: 999,
  })], 'daily', NOW).rows[0];

  assert.equal(row.member_start, 300);
  assert.equal(row.member_end, null);
  assert.equal(row.member_growth, null);
  assert.equal(row.member_growth_excluded, true);
});

test('daily recomputes member growth only when both boundaries exist', () => {
  const bounds = expectedPeriodBounds('daily', '2026-09-20');
  const row = applySummaryCompleteness([summaryRow('daily', '2026-09-20', {
    period_start: bounds.start,
    period_end: bounds.end,
    member_start: 300,
    member_end: 307,
    member_growth: 999,
  })], 'daily', NOW).rows[0];

  assert.equal(row.member_growth, 7);
  assert.equal(row.member_growth_excluded, false);
});

test('weekly member boundaries may be recovered up to one day before or after the period', () => {
  const key = '2026-09-07';
  const row = applySummaryCompleteness([summaryRow('weekly', key, {
    member_start: null,
    member_end: null,
    member_growth: null,
  })], 'weekly', NOW, [
    memberDay('2026-09-05', null, 300),
    memberDay('2026-09-15', 312, null),
  ]).rows[0];

  assert.equal(memberBoundaryToleranceMs('weekly'), DAY);
  assert.equal(row.member_start, 300);
  assert.equal(row.member_end, 312);
  assert.equal(row.member_growth, 12);
  assert.equal(row.member_growth_excluded, false);
});

test('weekly member boundaries beyond one day remain missing', () => {
  const row = applySummaryCompleteness([summaryRow('weekly', '2026-09-07', {
    member_start: null,
    member_end: null,
    member_growth: null,
  })], 'weekly', NOW, [
    memberDay('2026-09-04', null, 300),
    memberDay('2026-09-16', 312, null),
  ]).rows[0];

  assert.equal(row.member_start, null);
  assert.equal(row.member_end, null);
  assert.equal(row.member_growth, null);
  assert.equal(row.member_growth_excluded, true);
});

test('monthly member boundaries may be recovered up to three days before or after the period', () => {
  const row = applySummaryCompleteness([summaryRow('monthly', '2026-08', {
    member_start: null,
    member_end: null,
    member_growth: null,
  })], 'monthly', NOW, [
    memberDay('2026-07-28', null, 400),
    memberDay('2026-09-04', 430, null),
  ]).rows[0];

  assert.equal(memberBoundaryToleranceMs('monthly'), 3 * DAY);
  assert.equal(row.member_start, 400);
  assert.equal(row.member_end, 430);
  assert.equal(row.member_growth, 30);
  assert.equal(row.member_growth_excluded, false);
});

test('monthly member boundaries beyond three days remain missing', () => {
  const row = applySummaryCompleteness([summaryRow('monthly', '2026-08', {
    member_start: null,
    member_end: null,
    member_growth: null,
  })], 'monthly', NOW, [
    memberDay('2026-07-27', null, 400),
    memberDay('2026-09-05', 430, null),
  ]).rows[0];

  assert.equal(row.member_start, null);
  assert.equal(row.member_end, null);
  assert.equal(row.member_growth, null);
  assert.equal(row.member_growth_excluded, true);
});

test('daily persistence uses only the immediately previous calendar day', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_daily_summary(
    period_key TEXT PRIMARY KEY,
    member_start INTEGER,
    member_end INTEGER,
    member_growth INTEGER
  );`);
  db.prepare('INSERT INTO sh_daily_summary VALUES(?,?,?,?)')
    .run('2024-11-21', null, 100, null);
  db.prepare('INSERT INTO sh_daily_summary VALUES(?,?,?,?)')
    .run('2024-11-23', 100, 120, 20);

  const migration = readFileSync(
    new URL('../database/other-migrations/026_daily_member_immediate_previous.sql', import.meta.url),
    'utf8',
  );
  db.exec(migration);

  let nov23 = db.prepare('SELECT * FROM sh_daily_summary WHERE period_key=?').get('2024-11-23');
  assert.equal(nov23.member_start, null);
  assert.equal(nov23.member_growth, null);

  db.prepare('INSERT INTO sh_daily_summary VALUES(?,?,?,?)')
    .run('2024-11-22', null, 110, null);
  const nov22 = db.prepare('SELECT * FROM sh_daily_summary WHERE period_key=?').get('2024-11-22');
  nov23 = db.prepare('SELECT * FROM sh_daily_summary WHERE period_key=?').get('2024-11-23');
  assert.equal(nov22.member_start, 100);
  assert.equal(nov22.member_growth, 10);
  assert.equal(nov23.member_start, 110);
  assert.equal(nov23.member_growth, 10);

  db.prepare('UPDATE sh_daily_summary SET member_end=NULL WHERE period_key=?').run('2024-11-22');
  nov23 = db.prepare('SELECT * FROM sh_daily_summary WHERE period_key=?').get('2024-11-23');
  assert.equal(nov23.member_start, null);
  assert.equal(nov23.member_growth, null);
});
