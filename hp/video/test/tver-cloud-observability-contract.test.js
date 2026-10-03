import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const unifiedWorker = readFileSync(
  new URL('../../cloud/src/unified_worker.js', import.meta.url),
  'utf8',
);
const observability = readFileSync(
  new URL('../../cloud/src/tver_feed_observability.js', import.meta.url),
  'utf8',
);

test('HomePanel health exposes TVer and radar diagnostics without coupling deployment health', () => {
  assert.match(unifiedWorker, /import \{ tverFeedObservability \}/);
  assert.match(unifiedWorker, /TVER_FEED_HEALTH_PATH = '\/api\/health\/tver-feed'/);
  assert.match(
    unifiedWorker,
    /pathname === TVER_FEED_HEALTH_PATH[\s\S]*tverFeedHealthResponse\(env\)/,
  );
  assert.match(
    unifiedWorker,
    /pathname === '\/api\/health'[\s\S]*homePanelCloudHealthResponse\(env\)/,
  );
  assert.match(unifiedWorker, /async function videoDatabaseHealth\(env\)/);
  assert.match(unifiedWorker, /prepare\?\.\('SELECT 1 AS ok'\)/);
  assert.match(unifiedWorker, /tverFeedObservability\(env\)/);
  assert.match(unifiedWorker, /radarFrameObservability\(env\)/);
  assert.match(unifiedWorker, /const ok = videoHealth\.ok === true;/);
  assert.match(unifiedWorker, /status: ok \? 200 : 503/);
  const healthFunction = unifiedWorker.match(/async function homePanelCloudHealthResponse\(env\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.doesNotMatch(healthFunction, /integratedVideoFetch|loadVideoWorker/);
  assert.doesNotMatch(unifiedWorker, /const ok = videoOk && radar\.ok/);
  assert.doesNotMatch(unifiedWorker, /const ok = videoOk && tverFeed\.ok/);
});

test('TVer collector observability reports freshness, count, source, and last success', () => {
  assert.match(observability, /TVER_FEED_OBSERVABILITY_MAX_AGE_MS/);
  assert.match(observability, /90 \* 60 \* 1000/);
  assert.match(observability, /lastSuccessAt/);
  assert.match(observability, /ageSeconds/);
  assert.match(observability, /episodeCount/);
  assert.match(observability, /sources/);
  assert.match(observability, /status: 'fresh'/);
  assert.match(observability, /failure\('stale'/);
  assert.match(observability, /failure\('missing'/);
  assert.match(observability, /failure\('empty'/);
});
