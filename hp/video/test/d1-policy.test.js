import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const entry = await readFile(new URL('../src/entry.js', import.meta.url), 'utf8');
const entryCore = await readFile(new URL('../src/entry-core.js', import.meta.url), 'utf8');
const compactedFeed = await readFile(
  new URL('../src/source-feed-compacted.js', import.meta.url),
  'utf8'
);
const playbackFeedSync = await readFile(
  new URL('../src/playback-feed-sync.js', import.meta.url),
  'utf8'
);
const feedSnapshot = await readFile(
  new URL('../src/feed-snapshot.js', import.meta.url),
  'utf8'
);
const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');

test('authenticated status responses remain private behind the gateway boundary', () => {
  assert.match(entryCore, /if \(!authorized\(request, env\)\) return unauthorized\(\)/);
  assert.match(entry, /X-HomePanel-Internal-Service/);
  assert.match(entry, /return core\.fetch\(/);
  assert.doesNotMatch(entry, /migrationFreezeEnabled/);
  assert.doesNotMatch(entry, /protectPrivateStatusResponse/);
  assert.doesNotMatch(entry, /cache\.match\(/);
  assert.doesNotMatch(entry, /cache\.put\(/);
  assert.match(entryCore, /'cache-control', 'private, no-store'/);
  assert.doesNotMatch(entryCore, /STATUS_SHARED_CACHE_CONTROL/);
});

test('admin collect-all runs the active source set once with one feed finalization', () => {
  assert.match(entryCore, /runAllScheduledCollections\(env\)/);
  assert.doesNotMatch(entryCore, /for \(const path of ADMIN_COLLECTION_PATHS\)/);
});

test('individual admin collectors merge collected candidates and finalize once', () => {
  assert.match(entryCore, /ADMIN_COLLECTION_PATHS\.includes\((?:url\.)?pathname\)/);
  assert.match(entryCore, /runOneAdminCollector\((?:url\.)?pathname, env, ctx\)/);
  assert.match(entryCore, /finally\(\(\) => invalidateCaches\(env\.DB\)\)/);
  assert.match(entryCore, /status: 202/);
  assert.match(worker, /deferFeedMaintenance: true/);
  assert.match(worker, /collectionItems = new Map\(\)/);
  assert.match(worker, /mergeItems: \[\.\.\.collectionItems\.values\(\)\]/);
  assert.doesNotMatch(worker, /json\(await runAndRecord/);
});

test('compacted finalization serializes through the video Durable Object and publishes R2', () => {
  assert.match(compactedFeed, /video-feed-finalize/);
  assert.match(compactedFeed, /video-feed-stage/);
  assert.match(compactedFeed, /video-feed-refresh/);
  assert.match(compactedFeed, /lock: false/);
  assert.match(compactedFeed, /publishFeedSnapshot/);
  assert.match(feedSnapshot, /video\/playback-feed\/v1\.json/);
  assert.match(feedSnapshot, /DATA_BUCKET|bucket/);
});

test('playback feed rebuild uses one diff plan and supports DO-local state commits', () => {
  assert.match(playbackFeedSync, /planPlaybackFeedChanges\(desiredRows, currentRows\)/);
  assert.match(playbackFeedSync, /feedContentHash\(rows\)/);
  assert.match(playbackFeedSync, /if \(options\.lock === false\)/);
  assert.match(playbackFeedSync, /writeFeedState\(db, outcome\.contentHash/);
  assert.match(playbackFeedSync, /withPlaybackFeedFinalization\(db, task\)/);
  assert.doesNotMatch(playbackFeedSync, /last_seen_at/);
});
