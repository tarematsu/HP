import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const fixes = readFileSync(new URL('../public/history/history-global-fixes.js', import.meta.url), 'utf8');
const pageFixes = readFileSync(new URL('../public/history/history-page-fixes.js', import.meta.url), 'utf8');

test('shared history fixes load for current, history, and likes views', () => {
  assert.match(entry, /import '\.\/history\/history-global-fixes\.js'/);
  assert.match(fixes, /\.dashboard-view \.data-panel/);
  assert.match(fixes, /\.likes-view \.table-wrap/);
  assert.match(fixes, /content-visibility:\s*visible\s*!important/);
});

test('summary metrics remain single-line at intermediate desktop and tablet widths', () => {
  assert.match(fixes, /\.dashboard-view \.summary-cards strong/);
  assert.match(fixes, /white-space:\s*nowrap\s*!important/);
  assert.match(fixes, /font-size:\s*clamp\(1\.15rem,\s*1\.8vw,\s*1\.55rem\)/);
});

test('ranking summary consumes the shared history payload instead of rendered-row observation', () => {
  assert.match(pageFixes, /history:data-loaded/);
  assert.match(pageFixes, /const rankedCount = rows\.filter/);
  assert.match(pageFixes, /const outCount = rows\.length - rankedCount/);
  assert.doesNotMatch(fixes, /function finiteRank|repairRankingSummary|rankingBody/);
});

test('current playback can recover missing labels from the track ranking projection', () => {
  assert.match(fixes, /ranking_only=1&ranking_limit=500/);
  assert.match(fixes, /spotifyTrackId/);
  assert.match(fixes, /repairPlaybackMetadata/);
});
