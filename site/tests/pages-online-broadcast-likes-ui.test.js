import { browserSource } from './helpers/dashboard-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const likes = browserSource('stationhead/likes.js');
const broadcasts = readFileSync(new URL('../public/history/history-broadcasts.js', import.meta.url), 'utf8');
const canvas = readFileSync(new URL('../public/dashboard-chart-canvas.js', import.meta.url), 'utf8');

test('like ranking and track list keep only Sakurazaka46 and unknown artists', () => {
  const adapter=browserSource('stationhead/buddies-read-model.js'); assert.match(adapter,/artist_filter/); assert.match(adapter,/櫻坂46/); assert.match(adapter,/normalizeLikes/); const renderer=browserSource('stationhead/likes.js'); assert.match(renderer,/runtime.likes.slice\(0, 10\)/); assert.match(renderer,/runtime.likes.forEach/); assert.match(renderer,/runtime.likes.map/);
});

test('official listening party graph reuses the shared chart palette and guide-line styling', () => {
  assert.match(broadcasts, /SERIES_COLORS/);
  assert.match(broadcasts, /drawDashboardGrid/);
  assert.match(broadcasts, /drawDashboardLine/);
  assert.match(canvas, /strokeStyle = 'rgba\(31,45,68,\.12\)'/);
  assert.match(broadcasts, /cssColor\('--muted'/);
  assert.doesNotMatch(broadcasts, /#ffffff18|#aaa3b5|hsla\(/);
});
