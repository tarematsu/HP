import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = (relativePath) => readFile(path.join(siteRoot, relativePath), 'utf8');
const runtime = await text('public/stationhead-channel.js');
const readModel = await text('public/stationhead-channel-read-model.js');

test('dashboard entry installs the shared Stationhead renderer lazily', async () => {
  const entry = await text('public/dashboard-metrics.js');
  assert.match(await text('public/dashboard-tabs.js'), /stationhead-channel\.js\?v=/);
  assert.doesNotMatch(entry, /dashboard-chart-comparison\.js|dashboard-chart-detail\.js|dashboard-current-enhancements\.js|dashboard-details-client\.js/);
  assert.match(runtime, /function renderCurrentChart\(/);
  assert.match(runtime, /function renderPlayback\(/);
});

test('shared current chart overlays the previous 24-hour series on the current time axis', () => {
  assert.match(readModel, /previous_day_history: previousDayHistory\(payload\?\.previous_day_history\)/);
  assert.match(runtime, /finite\(row\.observed_at\) \+ DAY_MS/);
  assert.match(runtime, /PREVIOUS_ONLINE_COLOR = '#969ca6'/);
  assert.match(runtime, /entries\.push\(\['24時間前', PREVIOUS_ONLINE_COLOR\]\)/);
  assert.match(runtime, /drawOnlineSeries\(context, previous, x, y, PREVIOUS_ONLINE_COLOR, 2\)/);
  assert.match(runtime, /drawOnlineSeries\(context, rows, x, y, '#111', 2\)/);
});

test('shared current chart renders direct five-minute playback bars and explicit axes', () => {
  assert.match(runtime, /row\.stream_delta_5m/);
  assert.match(runtime, /const STREAM_BAR_COLOR = '#168b73'/);
  assert.match(runtime, /context\.fillRect\(x\(row\.observed_at\) - barWidth \/ 2/);
  assert.match(runtime, /fillText\('オンライン数（人）'/);
  assert.match(runtime, /fillText\('再生数増加'/);
  assert.match(runtime, /fillText\('時刻（JST）'/);
  assert.doesNotMatch(runtime, /comment_velocity|commentVelocity|コメント\/2分/);
});

test('shared current chart labels extrema with JST time and no bordered callout', () => {
  assert.match(runtime, /const EXTREMA_POINT_COLOR = '#888'/);
  assert.match(runtime, /\$\{label\} \$\{integer\.format\(Math\.round\(value\)\)\}（\$\{jstTime\.format/);
  assert.match(runtime, /context\.arc\(x\(row\.observed_at\), y\(value\), 3/);
  assert.doesNotMatch(runtime, /strokeRect\(/);
});

test('shared current chart detail selects the nearest direct five-minute count', () => {
  assert.match(runtime, /function nearestRow\(/);
  assert.match(runtime, /FIVE_MINUTES_MS \/ 2/);
  assert.match(runtime, /再生数増加 \+\$\{numberText\(streamRow\.stream_delta_5m\)\}/);
  assert.match(runtime, /live-chart'\)\?\.addEventListener\('pointerup'/);
});

test('shared listening-party chart compares every returned event series', () => {
  assert.match(runtime, /const series = \(Array\.isArray\(payload\?\.series\)/);
  assert.match(runtime, /const allPoints = series\.flatMap\(\(item\) => item\.points\)/);
  assert.match(runtime, /series\.forEach\(\(item, index\) => \{ context\.strokeStyle = colorFor\(index\)/);
  assert.match(runtime, /span\.textContent = item\.name/);
  assert.doesNotMatch(runtime, /payload\?\.series\) \? payload\.series\.find/);
});
