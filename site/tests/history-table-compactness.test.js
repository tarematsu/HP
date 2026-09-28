import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const cleanup = readFileSync(new URL('../public/history/history-table-cleanup.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/history/history-lite.css', import.meta.url), 'utf8');
const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');

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

test('mode-specific table meaning classes do not leak across tabs', () => {
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

test('history tab transitions reset shared summary and pagination state without loading copy', () => {
  assert.match(cleanup, /function resetSharedHistorySummary\(mode\)/);
  assert.match(cleanup, /for \(const id of \['periods', 'maxListener', 'streamGrowth', 'memberGrowth'\]\) setText\(id, '—'\)/);
  assert.match(cleanup, /notice\.textContent = ''/);
  assert.doesNotMatch(cleanup, /読み込み中/);
  assert.match(cleanup, /if \(more\) more\.hidden = true/);
  assert.match(cleanup, /resetSharedHistorySummary\(mode\)/);
});

test('table widths are owned by the shared stylesheet instead of runtime style injection', () => {
  assert.match(entry, /history-table-cleanup\.js\?v=20260928\.1/);
  assert.doesNotMatch(cleanup, /createElement\('style'\)|installMobileTableWidthStyle|MOBILE_TABLE_STYLE_ID/);
  assert.match(sharedLayout, /table\.compact-columns:not\(\.all-host-ranking-table\)[\s\S]*min-width:\s*760px !important/);
  assert.match(sharedLayout, /table\.all-host-ranking-table\.compact-columns[\s\S]*min-width:\s*980px !important/);
  assert.match(sharedLayout, /table\.weekly-ranking-table[\s\S]*min-width:\s*560px !important/);
  assert.match(sharedLayout, /\.table-wrap\.table-fit-mobile[\s\S]*overflow-x:\s*hidden !important/);
  assert.match(sharedLayout, /\.table-fit-mobile > table[\s\S]*width:\s*100% !important[\s\S]*min-width:\s*0 !important[\s\S]*table-layout:\s*fixed !important/);
});

test('legacy component styles remain beneath the canonical shared layout', () => {
  assert.match(styles, /\.table-wrap table\.compact-columns,\s*\n\s*\.likes-view \.table-wrap table \{ width: max-content; min-width: 0; \}/);
  assert.match(styles, /\.likes-view \.table-wrap th,\s*\n\s*\.likes-view \.table-wrap td \{ padding-inline: 6px; \}/);
  assert.match(sharedLayout, /\.table-wrap\s*\{[\s\S]*overflow-x:\s*auto/);
});
