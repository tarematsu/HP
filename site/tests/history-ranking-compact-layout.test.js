import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/leaderboard-shell.js', import.meta.url), 'utf8');
const runtime = browserSource('leaderboard.js');
const readModel = readFileSync(new URL('../public/leaderboard-read-model.js', import.meta.url), 'utf8');
const historyShell = readFileSync(new URL('../public/history-shell.js', import.meta.url), 'utf8');

test('leaderboard uses QQ-style update metadata above chart and data', () => {
  assert.match(shell, /id="leaderboardCompactMeta" class="regional-chart-meta"/);
  assert.match(shell, /更新日時 <strong id="leaderboardUpdatedAt">-<\/strong>/);
  assert.match(shell, /更新周期 <strong id="leaderboardCadence">-<\/strong>/);
  assert.match(readModel, /updated_at: timestamp\(payload\?\.materialized_at\)/);
  assert.match(readModel, /cadence: '毎週月曜日夜'/);
  assert.match(runtime, /timeZone: 'Asia\/Tokyo'/);
  assert.match(runtime, /updated\.textContent = formatUpdatedAt\(payload\?\.updated_at\)/);
  assert.match(runtime, /cadence\.textContent = String\(payload\?\.cadence \|\| '-'\)/);
});

test('shared leaderboard owns only metadata, chart, and data surfaces', () => {
  assert.match(shell, /id: 'leaderboardChartPanel'/);
  assert.match(shell, /title: '過去ランクイン一覧',\s*titleId: 'leaderboardTableTitle'/);
  assert.match(readModel, /table_title: '過去ランクイン一覧'/);
  assert.match(runtime, /tableTitle\.textContent = String\(payload\?\.table_title \|\| '過去ランクイン一覧'\)/);
  assert.match(shell, /className: 'leaderboard-table'/);
  assert.doesNotMatch(shell, /dashboardControls|dashboardSummary|rankingWeeklyPanel|id="csv"/);
  assert.doesNotMatch(shell, /history-ranking-compact-layout\.js/);
  assert.doesNotMatch(historyShell, /rankingCompactMeta|rankingUpdatedAt|history-ranking-compact-layout\.js/);
});

test('mobile leaderboard has separate full-width cards without desktop table overflow', () => {
  const table = readFileSync(new URL('../public/leaderboard/table.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/leaderboard.css', import.meta.url), 'utf8');
  assert.match(table, /leaderboard-mobile-card/);
  assert.match(table, /leaderboard-mobile-field/);
  assert.match(table, /field\.dataset\.key = column\.key/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /\.leaderboard-mobile-card\s*\{\s*display: grid/);
  assert.match(css, /\.leaderboard-view \.table-wrap\.table-fit-mobile\s*\{\s*display: none/);
  assert.match(shell, /id="leaderboardMobileList"/);
  assert.match(shell, /週間リーダーボード/);
});
