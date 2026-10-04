import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8') + readFileSync(new URL('../public/dashboard-presentation.css', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const readModel = readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8');

test('shared static presentation is bundled into the initial dashboard stylesheet', () => {
  assert.match(html, /assets\/dashboard\.min\.css\?v=\d{8}\.\d+/);
  assert.match(buildScript, /'dashboard-presentation\.css'/);
  assert.doesNotMatch(entry, /dashboard-(?:root-)?presentation\.css|history-global-fixes|dashboard-current-metric-style/);
  assert.match(styles, /\.data-panel/);
  assert.match(styles, /\.summary-cards strong/);
  assert.match(styles, /\.metric strong/);
  assert.match(styles, /\.likes-view \.table-wrap/);
  assert.match(styles, /content-visibility:\s*visible/);
  assert.doesNotMatch(entry, /createElement\('style'\)|createElement\('link'\)/);
});

test('history summary metrics generate final labels and ranking counts directly', () => {
  assert.match(history, /period: '総週数'/);
  assert.match(history, /max: 'ランクイン週数'/);
  assert.match(history, /stream: '圏外・欠測週数'/);
  assert.match(history, /period: '対象週数'/);
  assert.match(history, /max: '掲載ホスト数'/);
  assert.match(history, /stream: '延べランクイン数'/);
  assert.match(history, /member: '圏外・欠測数'/);
  assert.match(history, /outWeeks: Math\.max\(0, totalWeeks - rankedWeeks\)/);
});

test('current playback uses queue read-model metadata without a second repair fetch', () => {
  assert.doesNotMatch(entry, /ranking_only=1&ranking_limit=500|repairPlaybackMetadata|spotifyTrackId/);
  assert.doesNotMatch(runtime, /ranking_only=1&ranking_limit=500|repairPlaybackMetadata/);
  assert.match(runtime, /track\.title \|\| track\.display_title/);
  assert.match(runtime, /trackArtist\(track\)/);
  assert.match(readModel, /function trackTitle\(row\)/);
  assert.match(readModel, /function trackArtist\(row\)/);
});
