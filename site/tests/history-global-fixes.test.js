import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const fixes = readFileSync(new URL('../public/history/history-global-fixes.js', import.meta.url), 'utf8');

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

test('ranking summary derives listed and out-of-rank counts from rendered numeric ranks', () => {
  assert.match(fixes, /function finiteRank/);
  assert.match(fixes, /const ranked = rows\.filter/);
  assert.match(fixes, /const outOfRank = rows\.length - ranked/);
});

test('current playback can recover missing labels from the track ranking projection', () => {
  assert.match(fixes, /ranking_only=1&ranking_limit=500/);
  assert.match(fixes, /spotifyTrackId/);
  assert.match(fixes, /repairPlaybackMetadata/);
});
