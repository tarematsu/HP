import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { applyPreviousPeriodMemberStart } from '../functions/lib/history-summary.js';
import { CURRENT_DAILY_MINUTE_SUMMARY_SQL } from '../functions/lib/current-minute-summary.js';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const responsive = readFileSync(new URL('../public/period-display-fixes.css', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');

test('header last-updated formatter omits seconds while retaining JST conversion', () => {
  assert.match(header, /timeZone: 'Asia\/Tokyo'/);
  assert.doesNotMatch(header, /second:\s*'2-digit'/);
  assert.match(header, /UTC_UPDATED_PATTERN/);
});

test('mobile dashboard navigation stays on a four-column two-row grid', () => {
  assert.match(responsive, /@media \(max-width: 760px\)[\s\S]*grid-template-columns:\s*repeat\(4,/);
  assert.match(responsive, /@media \(max-width: 430px\)[\s\S]*grid-template-columns:\s*repeat\(4,/);
  assert.doesNotMatch(responsive, /repeat\(6,/);
});

test('daily weekly and monthly stream growth is rendered as bars', () => {
  assert.match(historyEntry, /history-period-chart\.js\?v=20260921\.1/);
  assert.match(periodChart, /new Set\(\['daily', 'weekly', 'monthly'\]\)/);
  assert.match(periodChart, /row\?\.stream_growth/);
  assert.match(periodChart, /fillRect\(/);
  assert.match(periodChart, /期間再生数/);
  assert.doesNotMatch(periodChart, /stream_end/);
});

test('member start uses the previous period end, correcting zero-growth historical rows', () => {
  const rows = [
    { period_key: '2024-11-21', member_start: 990, member_end: 1000, member_growth: 10 },
    { period_key: '2024-11-22', member_start: 1012, member_end: 1012, member_growth: 0 },
    { period_key: '2024-11-23', member_start: 1012, member_end: 1018, member_growth: 6 },
    { period_key: '2024-11-24', member_start: 1018, member_end: 1024, member_growth: 6 },
    { period_key: '2024-11-25', member_start: 1037, member_end: 1037, member_growth: 0 },
  ];
  const corrected = applyPreviousPeriodMemberStart(rows, 'daily', rows);
  const nov22 = corrected.find((row) => row.period_key === '2024-11-22');
  const nov25 = corrected.find((row) => row.period_key === '2024-11-25');
  assert.deepEqual(
    [nov22.member_start, nov22.member_end, nov22.member_growth],
    [1000, 1012, 12],
  );
  assert.deepEqual(
    [nov25.member_start, nov25.member_end, nov25.member_growth],
    [1024, 1037, 13],
  );
});

test('current UTC day member boundaries read yesterday final and today latest separately', () => {
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /previous_daily_member/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /day_at=\?1-86400000/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /latest_daily_member/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /day_at=\?1/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /previous_daily_member\) AS member_start/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /latest_daily_member\)[\s\S]*AS member_end/);
});
