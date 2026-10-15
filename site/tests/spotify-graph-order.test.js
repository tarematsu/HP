import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/spotify-trend-chart.js', import.meta.url), 'utf8');
const charts = readFileSync(new URL('../public/spotify-charts.js', import.meta.url), 'utf8');
const plays = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');

test('Spotify graphs restrict rendered series to the three Sakamichi groups in Sakurazaka-first order', () => {
  assert.match(runtime, /GRAPH_ARTIST_KEYS = Object\.freeze\(\['sakurazaka46', 'nogizaka46', 'hinatazaka46'\]\)/);
  assert.match(runtime, /GRAPH_ARTIST_KEYS\.indexOf\(a\.artistKey\) - GRAPH_ARTIST_KEYS\.indexOf\(b\.artistKey\)/);
  assert.match(runtime, /graphTrendSeries\(normalizeTrendSeries\(trend\), artistFilter\)/);
  assert.match(runtime, /nogizaka46: '#8264b0'/);
  assert.match(runtime, /sakurazaka46: '#b43a75'/);
  assert.match(runtime, /hinatazaka46: '#287ca6'/);
  assert.doesNotMatch(shell, /sortLegendByLatestValue|legendNumericValue|MutationObserver/);
});

test('Spotify renderer emits single-point markers directly on the shared canvas', () => {
  assert.match(runtime, /count === 1/);
  assert.match(runtime, /drawDashboardLine/);
  assert.match(runtime, /context\.arc\(xFor\(row\.date\), y\(row\.value\), 3/);
  assert.doesNotMatch(runtime, /spotify-single-point-line|createElementNS|svgElement/);
  assert.doesNotMatch(shell, /showSinglePointSeries|artistNameFromPoint|MutationObserver/);
});

test('separated Spotify views describe their own metrics', () => {
  assert.match(plays, /櫻坂46・乃木坂46・日向坂46の全曲合計再生数前日比推移/);
  assert.match(charts, /坂道グループの月間リスナー推移/);
  assert.match(charts, /取得済みの圏外と未取得の欠測を区別/);
  assert.doesNotMatch(shell, /group: 'listeners'|group: 'ranks'/);
});
