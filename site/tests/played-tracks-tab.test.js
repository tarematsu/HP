import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/played-tracks-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/played-tracks.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/track-history.js', import.meta.url), 'utf8');

test('played tracks tab is mounted immediately before likes', () => {
  assert.match(shell, /querySelector\('\[data-view="likes"\]'\)/);
  assert.match(shell, /button\.dataset\.view = 'played-tracks'/);
  assert.match(shell, /button\.textContent = '再生履歴'/);
  assert.match(shell, /likes\.insertAdjacentElement\('beforebegin', button\)/);
  assert.match(shell, /section\.id = 'playedTracksView'/);
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
  assert.doesNotMatch(shell, /延べ再生曲数|のべ再生曲数|<h2>再生曲一覧<\/h2>/);
  assert.doesNotMatch(runtime, /曲を集計/);
  assert.match(runtime, /setNotice\(state\.total > 0 \? '' :/);
});

test('weekly played tracks uses a Monday start and seven-day range', () => {
  assert.match(runtime, /const offset = \(date\.getUTCDay\(\) \+ 6\) % 7/);
  assert.match(runtime, /\{ from: state\.selectedPeriod, to: addDays\(state\.selectedPeriod, 6\) \}/);
  assert.match(runtime, /state\.availableDates\.map\(startOfWeek\)/);
  assert.match(runtime, /normalizedRows\(payload\.rows, from, to\)/);
});

test('played tracks chart uses neon colors and labels only the top five tracks', () => {
  assert.match(runtime, /hsl\(\$\{hue\} 100% 60%\)/);
  assert.match(runtime, /if \(index < 5\)/);
  assert.match(runtime, /const rawTitle = trackLabel\(label\.row\)/);
  assert.match(runtime, /integer\.format\(label\.row\.play_count\)/);
  assert.match(runtime, /上位5曲は曲名と再生数を表示/);
});

test('track history exposes a lightweight date index from the daily read model', () => {
  assert.match(api, /url\.searchParams\.get\('dates_only'\) === '1'/);
  assert.match(api, /FROM sh_pages_track_history_daily_read_model/);
  assert.match(api, /WHERE row_count>0/);
  assert.match(api, /latest_date: dates\.at\(-1\) \|\| null/);
});

test('played tracks runtime is lazy while its shell loads before dashboard tabs', () => {
  assert.match(metrics, /played-tracks-shell\.js\?v=20260924\.3/);
  assert.ok(metrics.indexOf('played-tracks-shell.js') < metrics.indexOf('dashboard-tabs.js'));
  assert.match(metrics, /dashboard-tabs\.js\?v=20260924\.2/);
  assert.match(tabs, /'played-tracks'/);
  assert.match(tabs, /import\('\/played-tracks\.js\?v=20260924\.2'\)/);
});
