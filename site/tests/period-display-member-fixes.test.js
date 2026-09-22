import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  applyPreviousPeriodMemberStart,
  summaryContextStartKey,
} from '../functions/lib/history-summary.js';
import { CURRENT_DAILY_MINUTE_SUMMARY_SQL } from '../functions/lib/current-minute-summary.js';

const header = readFileSync(new URL('../public/dashboard-header.js', import.meta.url), 'utf8');
const responsive = readFileSync(new URL('../public/period-display-fixes.css', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const periodChart = readFileSync(new URL('../public/history/history-period-chart.js', import.meta.url), 'utf8');
const persistenceMigration = readFileSync(
  new URL('../../database/other-migrations/024_persist_daily_member_growth.sql', import.meta.url),
  'utf8',
);

test('header update formatter omits seconds and renders the dashboard materialized time in JST', () => {
  assert.match(header, /timeZone: 'Asia\/Tokyo'/);
  assert.doesNotMatch(header, /second:\s*'2-digit'/);
  assert.match(header, /DASHBOARD_MATERIALIZED_AT_CACHE_KEY/);
  assert.match(header, /const next = `更新 \$\{refreshText\}`/);
  assert.match(header, /updated\.title = `更新 \$\{refreshText\} JST`/);
  assert.doesNotMatch(header, /5分毎/);
});

test('mobile dashboard navigation stays on a four-column two-row grid', () => {
  assert.match(responsive, /@media \(max-width: 760px\)[\s\S]*grid-template-columns:\s*repeat\(4,/);
  assert.match(responsive, /@media \(max-width: 430px\)[\s\S]*grid-template-columns:\s*repeat\(4,/);
  assert.doesNotMatch(responsive, /repeat\(6,/);
});

test('daily weekly and monthly stream growth is rendered as bars from the shared payload', () => {
  assert.match(historyEntry, /history-period-chart\.js\?v=20260923\.2/);
  assert.match(periodChart, /new Set\(\['daily', 'weekly', 'monthly'\]\)/);
  assert.match(periodChart, /history:data-loaded/);
  assert.match(periodChart, /detail\.data/);
  assert.match(periodChart, /row\?\.stream_growth/);
  assert.match(periodChart, /fillRect\(/);
  assert.match(periodChart, /期間再生数/);
  assert.doesNotMatch(periodChart, /stream_end|previousFetch|response\.clone\(\)\.json/);
});

test('historical member boundaries are read as persisted values without request-time recomputation', () => {
  const rows = [
    { period_key: '2024-11-21', member_start: 990, member_end: 1000, member_growth: 10 },
    { period_key: '2024-11-22', member_start: 1000, member_end: 1012, member_growth: 12 },
    { period_key: '2024-11-25', member_start: 1012, member_end: 1037, member_growth: 25 },
  ];
  const returned = applyPreviousPeriodMemberStart(rows, 'daily', rows);
  assert.equal(returned, rows);
  assert.deepEqual(
    returned.map(({ member_start, member_end, member_growth }) => [member_start, member_end, member_growth]),
    [[990, 1000, 10], [1000, 1012, 12], [1012, 1037, 25]],
  );
  assert.equal(summaryContextStartKey('daily', '2024-11-22'), '2024-10-08');
});

test('daily member repair is persisted once and future writes are normalized in OTHER_DB', () => {
  assert.match(persistenceMigration, /CREATE TABLE IF NOT EXISTS sh_data_repairs/);
  assert.match(persistenceMigration, /daily-member-growth-v1/);
  assert.match(persistenceMigration, /INSERT OR IGNORE INTO sh_data_repairs/);
  assert.match(persistenceMigration, /CREATE TRIGGER IF NOT EXISTS trg_sh_daily_summary_member_growth_insert/);
  assert.match(persistenceMigration, /CREATE TRIGGER IF NOT EXISTS trg_sh_daily_summary_member_growth_update/);
  assert.match(persistenceMigration, /previous\.period_key < NEW\.period_key/);
  assert.match(persistenceMigration, /member_growth = NEW\.member_end -/);
});

test('current UTC day member boundaries read yesterday final and today latest separately', () => {
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /previous_daily_member/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /day_at=\?1-86400000/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /latest_daily_member/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /day_at=\?1/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /previous_daily_member\) AS member_start/);
  assert.match(CURRENT_DAILY_MINUTE_SUMMARY_SQL, /latest_daily_member\)[\s\S]*AS member_end/);
});
