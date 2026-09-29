import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/history/history-lite.css', import.meta.url), 'utf8');
const sharedLayout = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');

test('leaderboard renderer defines only final visible single-host columns', () => {
  assert.match(history, /const RANKING_COLUMNS = \[[\s\S]*\['ranking_date', '週'\][\s\S]*\['host_name', 'ホスト'\][\s\S]*\['stationhead_channel_name', 'チャンネル'\][\s\S]*\['artist_name', 'アーティスト名'\][\s\S]*\['relation_label', '種別'\][\s\S]*\['rank', '順位'\]/);
  assert.doesNotMatch(history, /\['previous_rank', '前週順位'\]|\['rank_change', '前週比'\]|\['ranking_type', 'ランキング種別'\]|\['source_sheet', '順位データ出典'\]/);
  assert.match(history, /classList\.toggle\('compact-columns', mode === 'ranking'\)/);
});

test('mode-specific table classes are set by the root table renderer', () => {
  assert.match(history, /function syncTableModeClass\(mode\)/);
  assert.match(history, /classList\.toggle\('official-party-table', mode === 'broadcasts'\)/);
  assert.match(history, /classList\.remove\('all-host-ranking-table'\)/);
  assert.match(history, /syncTableModeClass\(mode\)/);
});

test('history transitions clear root state before the next mode renders', () => {
  assert.match(history, /function resetData\(\)/);
  assert.match(history, /state\.rows = \[\]/);
  assert.match(history, /state\.tableRows = \[\]/);
  assert.match(history, /el\('tbody'\)\.replaceChildren\(\)/);
  assert.match(history, /state\.rankingMetadataByHost\.clear\(\)/);
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
