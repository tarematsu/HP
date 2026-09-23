import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const cleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/history/history-lite.css', import.meta.url), 'utf8');

test('leaderboard list hides comparison and ranking-type columns', () => {
  assert.match(cleanup, /RANKING_REMOVED_LABELS = new Set\(\[[^\]]*'前週比'[^\]]*'ランキング種別'/s);
  assert.match(cleanup, /classList\.toggle\('compact-columns', mode === 'ranking'\)/);
});

test('table cleanup follows explicit history render and pagination events', () => {
  assert.match(cleanup, /history:data-loaded/);
  assert.match(cleanup, /history:runtime-ready/);
  assert.match(cleanup, /getElementById\('more'\)\?\.addEventListener/);
  assert.doesNotMatch(cleanup, /MutationObserver/);
});

test('mode-specific table layout classes do not leak across tabs', () => {
  assert.match(cleanup, /classList\.toggle\('official-party-table', mode === 'broadcasts'\)/);
  assert.match(cleanup, /mode !== 'ranking'\) table\.classList\.remove\('all-host-ranking-table'\)/);
  assert.match(cleanup, /syncTableModeClasses\(head\.closest\('table'\), mode\)/);
});

test('history tab transitions clear the previous table before the next mode renders', () => {
  assert.match(cleanup, /function prepareTableForModeTransition\(event\)/);
  assert.match(cleanup, /function resetHistoryTable\(mode\)/);
  assert.match(cleanup, /table\?\.classList\.remove\('all-host-ranking-table'\)/);
  assert.match(cleanup, /head\.replaceChildren\(\);[\s\S]*body\.replaceChildren\(\)/);
  assert.match(cleanup, /getElementById\('modeTabs'\)\?\.addEventListener\('click',[\s\S]*prepareTableForModeTransition\(event\)/);
});

test('ranking scope changes clear the previous ranking layout before reload', () => {
  assert.match(cleanup, /getElementById\('rankingScope'\)\?\.addEventListener\('change', \(\) => resetHistoryTable\('ranking'\)\)/);
});

test('history tab transitions reset shared summary and pagination state', () => {
  assert.match(cleanup, /function resetSharedHistorySummary\(mode\)/);
  assert.match(cleanup, /for \(const id of \['periods', 'maxListener', 'streamGrowth', 'memberGrowth'\]\) setText\(id, '—'\)/);
  assert.match(cleanup, /notice\.textContent = '読み込み中…'/);
  assert.match(cleanup, /if \(more\) more\.hidden = true/);
  assert.match(cleanup, /resetSharedHistorySummary\(mode\)/);
});

test('compact leaderboard and likes tables fill the mobile viewport', () => {
  assert.match(entry, /history-table-cleanup\.js\?v=20260923\.7/);
  assert.match(cleanup, /@media \(max-width: 760px\)/);
  assert.match(cleanup, /#historyView \.table-wrap table\.compact-columns,[\s\S]*#likesView \.table-wrap table[\s\S]*width: 100% !important;[\s\S]*min-width: 100% !important;[\s\S]*table-layout: fixed !important;/);
  for (const [column, width] of [[1, 22], [2, 19], [3, 17], [4, 20], [5, 12], [6, 10]]) {
    assert.match(cleanup, new RegExp(`table\\.compact-columns:not\\(\\.all-host-ranking-table\\) th:nth-child\\(${column}\\)[\\s\\S]*width: ${width}% !important`));
  }
});

test('legacy compact spacing remains available underneath the runtime override', () => {
  assert.match(styles, /\.table-wrap table\.compact-columns,\s*\n\s*\.likes-view \.table-wrap table \{ width: max-content; min-width: 0; \}/);
  assert.match(styles, /\.likes-view \.table-wrap th,\s*\n\s*\.likes-view \.table-wrap td \{ padding-inline: 6px; \}/);
});
