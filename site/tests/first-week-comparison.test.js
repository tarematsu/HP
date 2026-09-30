import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  FIRST_WEEK_READ_MODEL_SQL,
  FIRST_WEEK_RELEASES,
  loadFirstWeekComparison,
  normalizeFirstWeekRows,
  releaseOverlapsKnownGap,
  releaseStartMs,
} from '../functions/lib/first-week-comparison.js';
import { onRequestGet } from '../functions/api/first-week-comparison.js';

const byTitle = (title) => FIRST_WEEK_RELEASES.find((item) => item.title === title);
const readModelMigration = readFileSync(
  new URL('../../database/facts-migrations/058_first_week_comparison_read_model.sql', import.meta.url),
  'utf8',
);

test('title-track prerelease windows start at JST midnight and cover 10th through 16th', () => {
  assert.equal(FIRST_WEEK_RELEASES.length, 8);
  assert.equal(FIRST_WEEK_RELEASES[0].title, 'I want tomorrow to come');
  assert.equal(FIRST_WEEK_RELEASES.at(-1).title, '愛MUST BE');
  assert.equal(releaseStartMs(FIRST_WEEK_RELEASES[0]), Date.parse('2024-09-24T15:00:00Z'));
  assert.deepEqual(FIRST_WEEK_RELEASES.filter((item) => item.single === '15th').map((item) => item.title), ['What\'s “KAZOKU”?', 'Lonesome rabbit']);
});

test('known 2026 collection gap suppresses affected title tracks instead of inventing zeroes', () => {
  assert.equal(releaseOverlapsKnownGap(byTitle('The growing up train')), true);
  assert.equal(releaseOverlapsKnownGap(byTitle('What\'s “KAZOKU”?')), true);
  assert.equal(releaseOverlapsKnownGap(byTitle('Lonesome rabbit')), true);
  assert.equal(releaseOverlapsKnownGap(byTitle('愛MUST BE')), false);
});

test('public first-week reads use only the compact release read model', () => {
  assert.match(FIRST_WEEK_READ_MODEL_SQL, /FROM sh_first_week_comparison_read_model/);
  assert.doesNotMatch(FIRST_WEEK_READ_MODEL_SQL, /sh_minute_facts|GROUP BY|ROW_NUMBER|MATERIALIZED/);
  assert.match(readModelMigration, /CREATE TABLE IF NOT EXISTS sh_first_week_comparison_read_model/);
  assert.match(readModelMigration, /JOIN sh_minute_facts AS f INDEXED BY idx_sh_minute_facts_time/);
  assert.match(readModelMigration, /json_group_array/);
  assert.match(readModelMigration, /'2024-09-25'/);
  assert.match(readModelMigration, /'2026-09-17'/);
});

test('stream growth is rebased in the compact payload without masking counter regressions', () => {
  assert.deepEqual(normalizeFirstWeekRows([
    { elapsed_minutes: 0, listener_count: 100, stream_count: 1_000 },
    { elapsed_minutes: 5, listener_count: 105, stream_count: 1_025 },
    { elapsed_minutes: 10, listener_count: 110, stream_count: 900 },
  ]), [[0, 100, 0], [5, 105, 25], [10, 110, null]]);
  assert.deepEqual(normalizeFirstWeekRows([[0, 100, 1_000], [5, 105, 1_025]]), [[0, 100, 0], [5, 105, 25]]);
});

test('loader performs one compact read and preserves known-gap status', async () => {
  const prepared = [];
  const db = { prepare(sql) { prepared.push(sql); return { async all() { return { results: [
    { release_date_jst: '2024-09-25', point_count: 2, points_json: '[[0,866,1000],[5,870,1025]]', updated_at: 1 },
    { release_date_jst: '2026-09-17', point_count: 0, points_json: '[]', updated_at: 1 },
  ] }; } }; } };
  const result = await loadFirstWeekComparison(db);
  assert.equal(prepared.length, 1);
  assert.equal(prepared[0], FIRST_WEEK_READ_MODEL_SQL);
  assert.equal(result.series.length, 8);
  assert.equal(result.series[0].status, 'available');
  assert.deepEqual(result.series[0].points[1], [5, 870, 25]);
  assert.equal(byTitle('The growing up train').release_date_jst, '2026-02-12');
  assert.equal(result.series.find((item) => item.title === 'The growing up train').status, 'known_missing');
  assert.equal(result.series.find((item) => item.title === '愛MUST BE').status, 'no_data');
});

test('API rejects missing minute database binding', async () => {
  const response = await onRequestGet({ env: {} });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, 'MINUTE_DB binding missing');
});

test('dashboard keeps the first-week tab visible while deferring its shell and runtime', () => {
  const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
  const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
  const shell = readFileSync(new URL('../public/first-week-comparison-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/first-week-comparison.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/first-week-comparison.css', import.meta.url), 'utf8');
  assert.match(page, /data-view="first-week">初週比較/);
  assert.doesNotMatch(entry, /^import .*first-week-comparison-shell/m);
  assert.match(entry, /dashboard-tabs\.js\?v=20260930\.1/);
  assert.match(tabs, /first-week-comparison-shell\.js\?v=20260929\.1/);
  assert.doesNotMatch(shell, /\.css\?v=|style:\s*\{/);
  assert.match(shell, /dashboard-ui-common\.js\?v=20260930\.1/);
  assert.match(shell, /mountDashboardShell/);
  assert.doesNotMatch(shell, /first-week-metric-toggle|data-first-week-metric|再生数増加/);
  assert.match(shell, /view: 'first-week'/);
  assert.match(shell, /label: '初週比較'/);
  assert.match(shell, /anchorSelector: '\[data-view="spotify"\]'/);
  assert.doesNotMatch(shell, /firstWeekLoad|>更新</);
  assert.match(tabs, /'first-week'/);
  assert.match(tabs, /first-week-comparison\.js\?v=20260929\.1/);
  assert.match(runtime, /dashboard-ui-common\.js\?v=20260930\.1/);
  assert.match(runtime, /sh\.first-week-comparison\.v2/);
  assert.match(runtime, /first-week-comparison\?v=20260926\.2/);
  assert.doesNotMatch(runtime, /firstWeekLoad|loadButton|data-first-week-metric|metricButtons|metric === 'streams'/);
  assert.doesNotMatch(css, /#firstWeekLoad|#modeTabs\.mode-tabs\.dashboard-tabs/);
});

test('first-week view exposes listener comparison only', () => {
  const shell = readFileSync(new URL('../public/first-week-comparison-shell.js', import.meta.url), 'utf8');
  const runtime = readFileSync(new URL('../public/first-week-comparison.js', import.meta.url), 'utf8');
  assert.doesNotMatch(shell, /先行配信|グラフをタッチ|再生数増加/);
  assert.doesNotMatch(runtime, /先行配信|グラフをタッチ|再生数増加/);
  assert.match(shell, /ストリーミング配信後の同接推移/);
  assert.match(shell, /ストリーミング配信日/);
  assert.match(runtime, /point\?\.\[1\]/);
  assert.match(runtime, /\}人`/);
  assert.match(runtime, /detail\.replaceChildren\(\)/);
});

test('tab order ends with first-week comparison then Spotify', () => {
  const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
  const order = readFileSync(new URL('../public/dashboard-tab-order.js', import.meta.url), 'utf8');
  assert.match(entry, /dashboard-tab-order\.js\?v=20260929\.1/);
  assert.ok(entry.indexOf('dashboard-tab-order.js') < entry.indexOf('dashboard-tabs.js'));
  assert.match(order, /querySelector\('\[data-view="first-week"\]'\)/);
  assert.match(order, /querySelector\('\[data-view="spotify"\]'\)/);
  assert.match(order, /tabs\.append\(firstWeek\)/);
  assert.match(order, /tabs\.append\(spotify\)/);
  assert.ok(order.indexOf('append(firstWeek)') < order.indexOf('append(spotify)'));
});
