import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const text = (relativePath) => readFile(path.join(siteRoot, relativePath), 'utf8');

test('dashboard entry installs the sole previous-day comparison chart renderer', async () => {
  const entry = await text('public/dashboard-metrics.js');
  assert.match(entry, /dashboard-chart-comparison\.js\?v=20260923\.4/);
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

test('online comparison chart still renders comment velocity from the dashboard payload', async () => {
  const source = await text('public/dashboard-chart-comparison.js');
  assert.match(source, /comment_velocity/);
  assert.match(source, /context\.fillStyle = 'rgba\(22,139,115,\.42\)'/);
  assert.match(source, /context\.fillRect/);
  assert.match(source, /コメント\/2分/);
});

test('online extrema labels omit borders and include JST time', async () => {
  const source = await text('public/dashboard-chart-comparison.js');
  assert.match(source, /const jstExtremaTime = new Intl\.DateTimeFormat/);
  assert.match(source, /timeZone: 'Asia\/Tokyo'/);
  assert.match(source, /`最小 \$\{[^}]+\}（\$\{jstExtremaTime\.format/);
  assert.match(source, /`最大 \$\{[^}]+\}（\$\{jstExtremaTime\.format/);
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
