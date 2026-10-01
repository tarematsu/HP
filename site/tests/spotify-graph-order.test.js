import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');

test('Spotify graphs restrict rendered series to the three Sakamichi groups in Sakurazaka-first order', () => {
  assert.match(runtime, /GRAPH_ARTIST_KEYS = Object\.freeze\(\['sakurazaka46', 'nogizaka46', 'hinatazaka46'\]\)/);
  assert.match(runtime, /GRAPH_ARTIST_KEYS\.indexOf\(a\.artistKey\) - GRAPH_ARTIST_KEYS\.indexOf\(b\.artistKey\)/);
  assert.match(runtime, /graphTrendSeries\(normalizeTrendSeries\(trend\)\)/);
  assert.match(runtime, /monthlyListenerTrend\(monthlyListenerRows\)/);
  assert.match(runtime, /nogizaka46: '#8264b0'/);
  assert.match(runtime, /sakurazaka46: '#f3a6c8'/);
  assert.match(runtime, /hinatazaka46: '#9ecff3'/);
  assert.doesNotMatch(shell, /sortLegendByLatestValue|legendNumericValue|MutationObserver/);
});

test('Spotify renderer emits single-point markers directly on the shared canvas', () => {
  assert.match(runtime, /count === 1/);
  assert.match(runtime, /drawDashboardLine/);
  assert.match(runtime, /context\.arc\(xFor\(row\.date\), y\(row\.value\), 3/);
  assert.doesNotMatch(runtime, /spotify-single-point-line|createElementNS|svgElement/);
  assert.doesNotMatch(shell, /showSinglePointSeries|artistNameFromPoint|MutationObserver/);
});

test('Spotify accessibility labels describe the combined Sakamichi overview directly', () => {
  assert.match(runtime, /櫻坂46・乃木坂46・日向坂46の全曲合計再生数前日比とSpotify月間リスナー推移/);
  assert.match(runtime, /左軸が再生数前日比、右軸が月間リスナー/);
  assert.match(runtime, /Spotify日本 Daily Top Artist の順位データはまだありません。/);
  assert.match(runtime, /Spotify日本 Daily Top Artist の順位推移。1位が上。/);
  assert.match(shell, /Spotify 全曲合計再生数前日比・月間リスナー推移（坂道3グループ）/);
  assert.doesNotMatch(shell, /alignPlaycountAccessibilityLabels|alignArtistRankTerminology|installGraphPostProcessing/);
});
