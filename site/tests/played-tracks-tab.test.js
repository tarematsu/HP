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
  assert.match(runtime, /scrollIntoView\(\{/);
  assert.match(runtime, /inline: 'center'/);
  assert.doesNotMatch(runtime, /TARGET_DATE|2026-09-22/);
});

test('weekly played tracks uses a Monday start and seven-day range', () => {
  assert.match(runtime, /const offset = \(date\.getUTCDay\(\) \+ 6\) % 7/);
  assert.match(runtime, /\{ from: state\.selectedPeriod, to: addDays\(state\.selectedPeriod, 6\) \}/);
  assert.match(runtime, /state\.availableDates\.map\(startOfWeek\)/);
  assert.match(runtime, /normalizedRows\(payload\.rows, from, to\)/);
});

test('track history exposes a lightweight date index from the daily read model', () => {
  assert.match(api, /url\.searchParams\.get\('dates_only'\) === '1'/);
  assert.match(api, /FROM sh_pages_track_history_daily_read_model/);
  assert.match(api, /WHERE row_count>0/);
  assert.match(api, /latest_date: dates\.at\(-1\) \|\| null/);
});

test('played tracks runtime is lazy while its shell loads before dashboard tabs', () => {
  assert.match(metrics, /played-tracks-shell\.js\?v=20260924\.1/);
  assert.ok(metrics.indexOf('played-tracks-shell.js') < metrics.indexOf('dashboard-tabs.js'));
  assert.match(tabs, /'played-tracks'/);
  assert.match(tabs, /import\('\/played-tracks\.js\?v=20260924\.1'\)/);
});
