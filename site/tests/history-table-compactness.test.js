import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const history = browserSource('history/history-lite.js');
const styles = readFileSync(new URL('../public/history/history-lite.css', import.meta.url), 'utf8');
const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');

test('leaderboard renderer defines only final visible single-host columns', () => {
  const source=browserSource('leaderboard-read-model.js'); for(const key of ['period','rank','host','channel','artist','relation']) assert.match(source,new RegExp(`key: '${key}'`)); assert.doesNotMatch(history,/RANKING_COLUMNS/);
});

test('mode-specific table classes are set by the root table renderer', () => {
  assert.match(history,/classList.toggle\('official-party-table', mode === 'broadcasts'\)/); assert.doesNotMatch(history,/mode === 'ranking'|all-host-ranking-table/);
});

test('history root renderer reuses shared empty-row and listening-party duration helpers', () => {
  assert.match(history, /appendEmptyTableRow\(fragment, 'データがありません。', columns\.length\)/);
  assert.match(history, /durationLabel\(durations\.reduce/);
  assert.doesNotMatch(history, /function formatMinutes\s*\(/);
  assert.doesNotMatch(history, /td\.colSpan = columns\.length/);
});

test('history transitions clear root state before the next mode renders', () => {
  assert.match(history, /function resetData\(\)/);
  assert.match(history, /state\.rows = \[\]/);
  assert.match(history, /state\.tableRows = \[\]/);
  assert.match(history, /el\('tbody'\)\.replaceChildren\(\)/);
  assert.doesNotMatch(history, /rankingMetadataByHost/);
});

test('summary and pagination reset without loading copy', () => {
  assert.match(history, /updateSummary\(\);[\s\S]*history\.replaceState/);
  assert.match(history, /setNotice\(''\)/);
  assert.doesNotMatch(history, /読み込み中/);
  assert.match(history, /el\('more'\)\.hidden = state\.tableRows\.length <= state\.visibleRows/);
});

test('table widths are owned by shared styles instead of runtime table cleanup', () => {
  assert.doesNotMatch(entry, /history-table-cleanup/);
  assert.doesNotMatch(history, /createElement\('style'\)|installMobileTableWidthStyle|MOBILE_TABLE_STYLE_ID/);
  assert.match(sharedLayout, /table\.compact-columns:not\(\.all-host-ranking-table\)[\s\S]*min-width:\s*760px/);
  assert.match(sharedLayout, /table\.all-host-ranking-table\.compact-columns[\s\S]*min-width:\s*980px/);
  assert.match(sharedLayout, /table\.weekly-ranking-table[\s\S]*min-width:\s*560px/);
  assert.match(sharedLayout, /\.table-wrap\.table-fit-mobile[\s\S]*overflow-x:\s*auto/);
  assert.match(sharedLayout, /\.table-fit-mobile > table[\s\S]*width:\s*100%[\s\S]*min-width:\s*600px[\s\S]*table-layout:\s*auto/);
});

test('legacy component styles remain beneath the canonical shared layout', () => {
  assert.match(styles, /\.table-wrap table\.compact-columns,\s*\n\s*\.likes-view \.table-wrap table \{ width: max-content; min-width: 0; \}/);
  assert.match(styles, /\.likes-view \.table-wrap th,\s*\n\s*\.likes-view \.table-wrap td \{ padding-inline: 6px; \}/);
  assert.match(sharedLayout, /\.table-wrap\s*\{[\s\S]*overflow-x:\s*auto/);
});
