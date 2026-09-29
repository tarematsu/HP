import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');

test('Spotify playcount graph legends are ordered by latest displayed playcount descending', () => {
  assert.match(shell, /function legendNumericValue\(item\)/);
  assert.match(shell, /replaceAll\(',', ''\)/);
  assert.match(shell, /text\.match\(\/\[\+\-\]\?\\d\+\/\)/);
  assert.match(shell, /function sortLegendByLatestValue\(legend\)/);
  assert.match(shell, /\.sort\(\(a, b\) => \(b\.value - a\.value\)/);
  assert.match(shell, /#spotifyTrendCharts \.spotify-trend-legend, #spotifyTop10YearTrendCharts \.spotify-trend-legend/);
  assert.doesNotMatch(shell, /querySelectorAll\('\.spotify-trend-legend'\)\.forEach\(sortLegendByLatestValue\)/);
  assert.match(shell, /new MutationObserver\(processAll\)/);
  assert.match(shell, /observer\.observe\(view, \{ childList: true, subtree: true \}\)/);
});

test('Spotify graphs visibly render artists that only have one numeric point', () => {
  assert.match(shell, /function artistNameFromPoint\(circle\)/);
  assert.match(shell, /function showSinglePointSeries\(container\)/);
  assert.match(shell, /lineState\.set\(artistName, \/\\sL\\s\/\.test/);
  assert.match(shell, /spotify-single-point-line/);
  assert.match(shell, /circle\.setAttribute\('r', '3\.4'\)/);
  assert.match(shell, /取得済み1点/);
  assert.match(shell, /querySelectorAll\('\.spotify-trend-charts'\)\.forEach\(showSinglePointSeries\)/);
});
