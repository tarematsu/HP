import { browserSource } from './helpers/dashboard-source.js';
import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = browserSource('stationhead-channel-shell.js');
const stationheadShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const stationheadModel = readFileSync(new URL('../public/stationhead-channel-model.js', import.meta.url), 'utf8');
const runtime = browserSource('stationhead/played-tracks.js');
const tableDom = readFileSync(new URL('../public/dashboard-table-dom.js', import.meta.url), 'utf8');
const tabs = dashboardRouterSource();
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');
const r2Api = readFileSync(new URL('../../worker/src/pages-track-history-r2-api.js', import.meta.url), 'utf8');

test('played tracks is owned by the shared Stationhead model while the legacy deep-link shell remains lazy', () => {
  assert.match(stationheadModel,/value: 'played-tracks', label: '再生履歴'/); assert.match(stationheadShell,/data-stationhead-panel="played-tracks"/); assert.match(stationheadShell,/played-tracks-controls/); assert.doesNotMatch(metrics,/played-tracks-shell/);
});

test('played tracks exposes horizontal day navigation and weekly mode', () => {
  assert.match(shell,/role\('played-week'\)/); assert.match(shell,/role\('played-periods'\)/); assert.match(runtime,/periods.at\(-1\)/); assert.match(runtime,/runtime.playedPeriod = period/); assert.match(runtime,/playedSequence/);
});

test('played tracks removes manual refresh, hides successful aggregate status, and uses clear labels', () => {
  for(const label of ['総再生回数','楽曲数','楽曲別再生一覧']) assert.match(shell,new RegExp(label)); assert.match(runtime,/appendTableRow\(body/); assert.match(runtime,/再生履歴データ/); assert.doesNotMatch(shell,/playedTracksLoad/);
});

test('weekly played tracks uses a Monday start and seven-day range', async () => {
  const {weekStart,addDays}=await import('../public/stationhead/view-utils.js'); assert.equal(weekStart('2026-10-04'),'2026-09-28'); assert.equal(addDays('2026-09-28',6),'2026-10-04'); assert.match(runtime,/runtime.playedDates.map\(weekStart\)/); assert.match(runtime,/week \? addDays\(from, 6\) : from/);
});

test('played tracks chart uses the shared Canvas setup, neon colors, and fewer labels on narrow screens', async () => {
  const {playedChartRows}=await import('../public/stationhead/played-tracks.js'); const rows=Array.from({length:17},(_,i)=>({title:`song${i}`,play_count:17-i})); const chart=playedChartRows(rows); assert.equal(chart.length,16); assert.deepEqual(chart.at(-1),{label:'その他',play_count:3}); assert.match(runtime,/prepareDashboardCanvas/); assert.match(runtime,/width < 520/); assert.doesNotMatch(runtime,/getContext\('2d'\)/);
});

test('track history exposes a lightweight date index from the R2 day model', () => {
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /url\.searchParams\.append\(name, value\)/);
  assert.match(r2Api, /url\.searchParams\.get\('dates_only'\) === '1'/);
  assert.match(r2Api, /loadTrackHistoryDayIndex/);
  assert.match(r2Api, /latest_date: dates\.at\(-1\) \|\| null/);
  assert.doesNotMatch(r2Api, /sh_pages_track_history_daily_read_model/);
});

test('played tracks uses the lazy shared Stationhead runtime behind the router', () => {
  assert.doesNotMatch(metrics, /^import .*played-tracks-shell/m);
  assert.match(metrics, /dashboard-tabs\.js\?v=20261005\.2/);
  assert.match(tabs, /selectStationheadChannelSection/);
  assert.match(tabs, /'played-tracks'/);
});
