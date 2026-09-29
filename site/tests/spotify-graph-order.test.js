import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');

test('Spotify graph legends are ordered by the latest displayed number descending', () => {
  assert.match(shell, /function legendNumericValue\(item\)/);
  assert.match(shell, /replaceAll\(',', ''\)/);
  assert.match(shell, /text\.match\(\/\[\+\-\]\?\\d\+\/\)/);
  assert.match(shell, /function sortLegendByLatestValue\(legend\)/);
  assert.match(shell, /\.sort\(\(a, b\) => \(b\.value - a\.value\)/);
  assert.match(shell, /querySelectorAll\('\.spotify-trend-legend'\)\.forEach\(sortLegendByLatestValue\)/);
  assert.match(shell, /new MutationObserver\(sortAll\)/);
  assert.match(shell, /observer\.observe\(view, \{ childList: true, subtree: true \}\)/);
});
