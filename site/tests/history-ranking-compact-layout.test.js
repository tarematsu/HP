import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/leaderboard-shell.js', import.meta.url), 'utf8');
const runtime = browserSource('leaderboard.js');
const readModel = readFileSync(new URL('../public/leaderboard-read-model.js', import.meta.url), 'utf8');
const historyShell = readFileSync(new URL('../public/history-shell.js', import.meta.url), 'utf8');

test('leaderboard uses QQ-style update metadata above chart and data', () => {
  assert.match(shell, /dashboardUpdateMeta/);
  assert.match(shell, /id: 'leaderboardCompactMeta'/);
  assert.match(shell, /valueId: 'leaderboardUpdatedAt'/);
  assert.match(shell, /cadenceId: 'leaderboardCadence'/);
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

test('mobile leaderboard uses the shared card contract rather than bespoke layout code', () => {
  const table = readFileSync(new URL('../public/leaderboard/table.js', import.meta.url), 'utf8');
  const base = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
  const styles = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
  assert.match(table, /renderResponsiveTable/);
  assert.doesNotMatch(table, /createElement\\('article'\\)/);
  assert.match(base, /mobileCardsId/);
  assert.match(styles, /\\.dashboard-responsive-card/);
  assert.match(shell, /mobileCardsId: 'leaderboardMobileList'/);
  assert.match(shell, /週間リーダーボード/);
});
