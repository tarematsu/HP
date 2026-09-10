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

test('HomePanel health exposes TVer collector diagnostics without coupling deployment health', () => {
  assert.match(unifiedWorker, /import \{ tverFeedObservability \}/);
  assert.match(unifiedWorker, /TVER_FEED_HEALTH_PATH = '\/api\/health\/tver-feed'/);
  assert.match(
    unifiedWorker,
    /pathname === TVER_FEED_HEALTH_PATH[\s\S]*tverFeedHealthResponse\(env\)/,
  );
  assert.match(
    unifiedWorker,
    /pathname === '\/api\/health'[\s\S]*homePanelCloudHealthResponse\(request, env, ctx\)/,
  );
  assert.match(unifiedWorker, /tverFeedObservability\(env\)/);
  assert.match(unifiedWorker, /tverFeed,/);
  assert.match(unifiedWorker, /status: health\.ok \? 200 : 503/);
  assert.match(unifiedWorker, /status: videoResponse\.status/);
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
