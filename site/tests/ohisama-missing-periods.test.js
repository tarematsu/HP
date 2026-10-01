import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/hinata-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/hinata.js', import.meta.url), 'utf8');
const followersShell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');

test('Ohisama and followers chart headers omit update-time pills', () => {
  assert.doesNotMatch(shell, /hinataUpdated|更新時間|JST文字列/);
  assert.doesNotMatch(followersShell, /followersLatestDate/);
  assert.match(entry, /hinata-shell\.js\?v=20261001\.1/);
  assert.match(entry, /followers-shell\.js\?v=20261001\.1/);
});

test('Ohisama daily Canvas marks date gaps with the same missing-period treatment as history', () => {
  assert.doesNotMatch(shell, /hinata-missing-periods\.js/);
  assert.match(runtime, /dashboardMissingGapBands/);
  assert.match(runtime, /DASHBOARD_MISSING_KEY/);
  assert.match(runtime, /maxGap: DAY_MS \* 1\.5/);
  assert.match(runtime, /drawDashboardMissingBands/);
  assert.match(runtime, /appendDashboardLegendItem\('欠測', DASHBOARD_MISSING_KEY/);
  assert.match(runtime, /灰色は欠測期間です/);
});
