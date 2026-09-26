import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = (relativePath) => readFile(path.join(siteRoot, relativePath), 'utf8');

test('dashboard entry installs the sole previous-day comparison chart renderer', async () => {
  const entry = await text('public/dashboard-metrics.js');
  assert.match(entry, /dashboard-chart-comparison\.js\?v=20260927\.1/);
  assert.match(entry, /dashboard-chart-detail\.js\?v=20260927\.1/);
  assert.doesNotMatch(entry, /dashboard-current-enhancements\.js/);
});

test('online chart overlays the previous 24-hour series in gray on the current time axis', async () => {
  const source = await text('public/dashboard-chart-comparison.js');
  assert.match(source, /payload\?\.previous_day_history/);
  assert.match(source, /const shiftedAt = observedAt \+ DAY_MS/);
  assert.match(source, /previous\.textContent = '24時間前'/);
  assert.match(source, /drawSeries\(context, previous, xFor, yOnline, '#969ca6', 2\)/);
  assert.match(source, /drawSeries\(context, current, xFor, yOnline, '#111', 2\.5\)/);
});

test('current chart adds one-minute stream increase bars below the online series', async () => {
  const source = await text('public/dashboard-chart-comparison.js');
  assert.match(source, /payload\?\.stream_minute_history/);
  assert.match(source, /stream\.textContent = '再生数増加\/分'/);
  assert.match(source, /const STREAM_BAR_COLOR = '#168b73'/);
  assert.match(source, /function drawStreamBars\(/);
  assert.match(source, /context\.fillRect\(x - barWidth \/ 2, baseline - barHeight, barWidth, barHeight\)/);
  assert.match(source, /context\.fillText\('再生数増加\/分'/);
});

test('current online chart no longer renders comment velocity', async () => {
  const source = await text('public/dashboard-chart-comparison.js');
  assert.doesNotMatch(source, /comment_velocity|commentVelocity|コメント\/2分/);
  assert.match(source, /オンライン数\(人\)/);
});

test('online extrema labels omit borders, use gray points, and include JST time', async () => {
  const source = await text('public/dashboard-chart-comparison.js');
  assert.match(source, /const EXTREMA_POINT_COLOR = '#888'/);
  assert.match(source, /const jstExtremaTime = new Intl\.DateTimeFormat/);
  assert.match(source, /timeZone: 'Asia\/Tokyo'/);
  assert.match(source, /`最小 \$\{[^}]+\}（\$\{jstExtremaTime\.format/);
  assert.match(source, /`最大 \$\{[^}]+\}（\$\{jstExtremaTime\.format/);
  assert.match(source, /if \(minRow\) \{[\s\S]*context\.fillStyle = EXTREMA_POINT_COLOR/);
  assert.match(source, /if \(maxRow\) \{[\s\S]*context\.fillStyle = EXTREMA_POINT_COLOR/);
  assert.doesNotMatch(source, /strokeRect\(/);
});

test('online comparison chart waits for a real canvas width and redraws after layout changes', async () => {
  const source = await text('public/dashboard-chart-comparison.js');
  assert.match(source, /function canvasWidth\(canvas\)/);
  assert.match(source, /if \(!width\) return false/);
  assert.doesNotMatch(source, /bounds\.width \|\| 900/);
  assert.match(source, /new ResizeObserver/);
  assert.match(source, /observer\.observe\(canvas\)/);
});

test('chart detail shows the nearest one-minute stream increase when available', async () => {
  const source = await text('public/dashboard-chart-detail.js');
  assert.match(source, /payload\.stream_minute_history/);
  assert.match(source, /再生数増加 \+\$\{numberText\(streamRow\.stream_delta\)\}\/分/);
  assert.match(source, /nearestRow\(streamRows, targetTime, MINUTE_MS \* 1\.5\)/);
});
