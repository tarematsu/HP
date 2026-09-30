import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const historyApi = readFileSync(new URL('../functions/api/history.js', import.meta.url), 'utf8');
const rootPresentation = readFileSync(new URL('../public/dashboard-root-presentation.css', import.meta.url), 'utf8');
const officialCopyUrl = new URL('../public/official-listening-party-copy.js', import.meta.url);

test('dashboard metrics use one initial bundled stylesheet rule across views', () => {
  assert.match(html, /assets\/dashboard\.min\.css\?v=20261001\.1/);
  assert.match(buildScript, /'dashboard-root-presentation\.css'/);
  assert.doesNotMatch(metrics, /dashboard-current-metric-style|ensureRootPresentationStylesheet|createElement\('link'\)/);
  assert.match(rootPresentation, /\.dashboard-view \.metrics \.metric-value > strong/);
  assert.doesNotMatch(rootPresentation, /#currentView \.metrics/);
  assert.match(rootPresentation, /font-size: clamp\(1\.75rem, 5\.8vw, 2\.5rem\) !important/);
  assert.match(rootPresentation, /@media \(max-width: 760px\)[\s\S]*font-size: clamp\(1rem, 5vw, 1\.4rem\) !important/);
});

test('dashboard does not supplement queue metadata in the browser', () => {
  assert.doesNotMatch(metrics, /dashboard-queue-metadata-stability/);
  assert.doesNotMatch(metrics, /restoreKnownMetadata|const known = new Map/);
});

test('2025 year-end listening party copy comes from the history API source', () => {
  assert.equal(existsSync(officialCopyUrl), false);
  assert.doesNotMatch(metrics, /official-listening-party-copy\.js/);
  assert.doesNotMatch(historyEntry, /official-listening-party-copy\.js/);
  assert.match(historyApi, /content: '2025年にリリースした曲', tracks: 29/);
  assert.doesNotMatch(historyApi, /2025年にリリースした曲\(29曲\)/);
});
