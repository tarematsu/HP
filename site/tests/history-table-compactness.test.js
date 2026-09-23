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

test('compact leaderboard and likes tables fill the mobile viewport', () => {
  assert.match(entry, /history-table-cleanup\.js\?v=20260923\.2/);
  assert.match(cleanup, /@media \(max-width: 760px\)/);
  assert.match(cleanup, /#historyView \.table-wrap table\.compact-columns,[\s\S]*#likesView \.table-wrap table[\s\S]*width: 100% !important;[\s\S]*min-width: 100% !important;[\s\S]*table-layout: fixed !important;/);
  assert.match(cleanup, /table\.compact-columns:not\(\.all-host-ranking-table\) th:nth-child\(1\)[\s\S]*width: 27% !important/);
  assert.match(cleanup, /table\.compact-columns:not\(\.all-host-ranking-table\) th:nth-child\(2\)[\s\S]*width: 28% !important/);
  assert.match(cleanup, /table\.compact-columns:not\(\.all-host-ranking-table\) th:nth-child\(3\)[\s\S]*width: 33% !important/);
  assert.match(cleanup, /table\.compact-columns:not\(\.all-host-ranking-table\) th:nth-child\(4\)[\s\S]*width: 12% !important/);
});

test('legacy compact spacing remains available underneath the runtime override', () => {
  assert.match(styles, /\.table-wrap table\.compact-columns,\s*\n\s*\.likes-view \.table-wrap table \{ width: max-content; min-width: 0; \}/);
  assert.match(styles, /\.likes-view \.table-wrap th,\s*\n\s*\.likes-view \.table-wrap td \{ padding-inline: 6px; \}/);
});
