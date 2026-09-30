import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/played-tracks-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/played-tracks.js', import.meta.url), 'utf8');
const tableDom = readFileSync(new URL('../public/dashboard-table-dom.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../public/dashboard-tab-registry.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');
const r2Api = readFileSync(new URL('../../worker/src/pages-track-history-r2-api.js', import.meta.url), 'utf8');

test('played tracks tab is visible immediately and shell mounts its view', () => {
  assert.match(registry, /view: 'played-tracks', label: '再生履歴'/);
  assert.match(shell, /dashboard-ui-common\.js\?v=20261001\.1/);
  assert.match(shell, /mountDashboardShell/);
  assert.match(shell, /view: 'played-tracks'/);
  assert.match(shell, /label: '再生履歴'/);
  assert.match(shell, /anchorSelector: '\[data-view="likes"\]'/);
  assert.match(shell, /position: 'beforebegin'/);
  assert.match(shell, /id: 'playedTracksView'/);
  assert.match(shell, /dashboardControls/);
  assert.match(shell, /className: 'played-tracks-controls'/);
  assert.match(shell, /dashboardSummary/);
  assert.match(shell, /dashboardChartCard/);
  assert.match(shell, /dashboardDataCard/);
  assert.doesNotMatch(shell, /view-toolbar played-tracks-toolbar/);
});

test('played tracks exposes horizontal day navigation and weekly mode', () => {
  assert.match(shell, /id="playedTracksWeekMode" type="checkbox"/);
  assert.match(shell, /id="playedTracksPeriodScroller"/);
  assert.match(shell, /id="playedTracksPeriodStrip"/);
  assert.match(runtime, /\/api\/track-history\?dates_only=1/);
  assert.match(runtime, /state\.selectedPeriod = options\.at\(-1\)/);
  assert.match(runtime, /sub\.textContent = state\.weekMode \? '\(週\)' : `\(\$\{weekday\(period\)\}\)`/);
  assert.match(runtime, /renderPeriodNavigator\(\{ alignEnd: true \}\)/);
  assert.match(runtime, /scroller\.scrollLeft = scroller\.scrollWidth/);
  assert.match(runtime, /scrollIntoView\(\{/);
  assert.match(runtime, /inline: 'center'/);
  assert.doesNotMatch(runtime, /TARGET_DATE|2026-09-22/);
});

test('played tracks removes manual refresh, hides successful aggregate status, and uses clear labels', () => {
  assert.doesNotMatch(shell, /id="playedTracksLoad"|>更新<\/button>/);
  assert.match(shell, /総再生回数/);
  assert.match(shell, /楽曲数/);
  assert.match(shell, /楽曲別再生一覧/);
  assert.match(runtime, /appendTableRow\(tbody, \[/);
  assert.match(runtime, /'総再生回数'/);
  assert.match(tableDom, /export function appendTableRow\(/);
  assert.match(runtime, /再生履歴データ/);
  assert.doesNotMatch(shell, /延べ再生曲数|のべ再生曲数|<h2>再生曲一覧<\/h2>/);
  assert.doesNotMatch(runtime, /再生曲データ|再生曲の日付一覧|曲を集計/);
  assert.match(runtime, /setNotice\(state\.total > 0 \? '' :/);
});

test('weekly played tracks uses a Monday start and seven-day range', () => {
  assert.match(runtime, /const offset = \(date\.getUTCDay\(\) \+ 6\) % 7/);
  assert.match(runtime, /\{ from: state\.selectedPeriod, to: addDays\(state\.selectedPeriod, 6\) \}/);
  assert.match(runtime, /state\.availableDates\.map\(startOfWeek\)/);
  assert.match(runtime, /normalizedRows\(payload\.rows, from, to\)/);
});

test('played tracks chart uses neon colors and limits labels further on narrow screens', () => {
  assert.match(runtime, /hsl\(\$\{hue\} 100% 60%\)/);
  assert.match(runtime, /const labelLimit = rect\.width < 520 \? 3 : 5/);
  assert.match(runtime, /if \(index < labelLimit\)/);
  assert.match(runtime, /const rawTitle = trackLabel\(label\.row\)/);
  assert.match(runtime, /integer\.format\(label\.row\.play_count\)/);
  assert.match(runtime, /上位\$\{labelLimit\}曲は曲名と再生数を表示/);
});

test('track history exposes a lightweight date index from the R2 day model', () => {
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /url\.searchParams\.append\(name, value\)/);
  assert.match(r2Api, /url\.searchParams\.get\('dates_only'\) === '1'/);
  assert.match(r2Api, /loadTrackHistoryDayIndex/);
  assert.match(r2Api, /latest_date: dates\.at\(-1\) \|\| null/);
  assert.doesNotMatch(r2Api, /sh_pages_track_history_daily_read_model/);
});

test('played tracks shell and runtime are both lazy behind the shared router', () => {
  assert.doesNotMatch(metrics, /^import .*played-tracks-shell/m);
  assert.match(metrics, /dashboard-tabs\.js\?v=20260930\.1/);
  assert.match(tabs, /import\('\/played-tracks-shell\.js\?v=20260928\.1'\)/);
  assert.match(tabs, /'played-tracks'/);
  assert.match(tabs, /import\('\/played-tracks\.js\?v=20260927\.2'\)/);
});
