import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');

test('Spotify playcount graphs select and render latest-metric order at source', () => {
  assert.match(runtime, /selectTrendSeriesByLatestMetric\(normalizedSeries, metricKey, maxSeries\)/);
  assert.match(runtime, /\.sort\(\(a, b\) => \(b\.value - a\.value\)/);
  assert.match(runtime, /seriesList\.forEach\(\(\{ artistName, points \}, seriesIndex\)/);
  assert.match(runtime, /アイドル凡例と最新の再生数前日比/);
  assert.doesNotMatch(shell, /sortLegendByLatestValue|legendNumericValue|MutationObserver/);
});

test('Spotify renderer emits single-point markers directly on the shared canvas', () => {
  assert.match(runtime, /plotted\.length === 1/);
  assert.match(runtime, /drawDashboardLine/);
  assert.match(runtime, /context\.arc\(xFor\(row\.date\), yFor\(row\.value\), 3/);
  assert.doesNotMatch(runtime, /spotify-single-point-line|createElementNS|svgElement/);
  assert.doesNotMatch(shell, /showSinglePointSeries|artistNameFromPoint|MutationObserver/);
});

test('Spotify accessibility and Daily Top Artist terminology are generated directly', () => {
  assert.match(runtime, /最新日の全曲合計再生数前日比が大きい女性アイドル上位10組の推移/);
  assert.match(runtime, /Spotify日本 Daily Top Artist の順位データはまだありません。/);
  assert.match(runtime, /Spotify日本 Daily Top Artist の順位推移。1位が上。/);
  assert.doesNotMatch(shell, /alignPlaycountAccessibilityLabels|alignArtistRankTerminology|installGraphPostProcessing/);
});
