import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureDatabaseOnce } from '../src/db-init.js';
import { parsePlaybackCursor } from '../src/playback-cursor.js';
import {
  seedShufflePivot,
  videoShuffleKey,
} from '../src/playback-feed.js';
import {
  inferVideoDimensions,
  inferVideoOrientation,
  isVideoResolutionAllowed,
  normalizeVideoOrientationFilter,
} from '../src/video-orientation.js';
import { runScheduledConfigs } from '../src/worker.js';

test('playback shuffle and cursor primitives preserve deterministic order', () => {
  assert.equal(seedShufflePivot(1), 2_147_471_302);
  assert.equal(videoShuffleKey(42), (42 * 1_103_515_245) % 2_147_483_647);
  assert.deepEqual(parsePlaybackCursor('1.42.7'), {
    phase: 1,
    shuffleKey: 42,
    videoId: 7,
  });
});

test('orientation inference uses the final dimensions in a media URL', () => {
  assert.deepEqual(inferVideoDimensions('https://cdn.example/640x360/720x1280/video.mp4'), {
    width: 720,
    height: 1280,
  });
  assert.equal(inferVideoOrientation('https://cdn.example/640x360/720x1280/video.mp4'), 'vertical');
  assert.equal(inferVideoOrientation('https://cdn.example/1280x720/video.mp4'), 'horizontal');
  assert.equal(inferVideoOrientation('https://cdn.example/500x500/video.mp4'), 'square');
  assert.equal(inferVideoOrientation('not a url'), 'unknown');
  assert.equal(normalizeVideoOrientationFilter('vertical'), 'vertical');
  assert.equal(normalizeVideoOrientationFilter('horizontal'), 'horizontal');
  assert.equal(normalizeVideoOrientationFilter(' Vertical '), 'vertical');
  assert.equal(normalizeVideoOrientationFilter('HORIZONTAL'), 'horizontal');
  assert.equal(normalizeVideoOrientationFilter('square'), 'both');
  assert.equal(normalizeVideoOrientationFilter(null), 'both');
});

test('video resolution filter rejects media below 720p equivalent', () => {
  assert.equal(isVideoResolutionAllowed('https://cdn.example/1280x720/video.mp4'), true);
  assert.equal(isVideoResolutionAllowed('https://cdn.example/720x1280/video.mp4'), true);
  assert.equal(isVideoResolutionAllowed('https://cdn.example/1920x1080/video.mp4'), true);
  assert.equal(isVideoResolutionAllowed('https://cdn.example/1279x720/video.mp4'), false);
  assert.equal(isVideoResolutionAllowed('https://cdn.example/1280x719/video.mp4'), false);
  assert.equal(isVideoResolutionAllowed('https://cdn.example/719x1280/video.mp4'), false);
  assert.equal(isVideoResolutionAllowed('https://cdn.example/720x1279/video.mp4'), false);
  assert.equal(isVideoResolutionAllowed('https://cdn.example/1080x1080/video.mp4'), false);
  assert.equal(isVideoResolutionAllowed('https://cdn.example/no-dimensions/video.mp4'), true);
});

test('database initialization coalesces callers and retries after failure', async () => {
  const db = {};
  let runs = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const initializer = async () => {
    runs += 1;
    await gate;
    return 'ready';
  };
  const first = ensureDatabaseOnce(db, 'integration-key', initializer);
  const second = ensureDatabaseOnce(db, 'integration-key', initializer);
  release();
  assert.equal(await first, 'ready');
  assert.equal(await second, 'ready');
  assert.equal(runs, 1);

  const retryDb = {};
  let attempts = 0;
  await assert.rejects(ensureDatabaseOnce(retryDb, 'retry-key', async () => {
    attempts += 1;
    throw new Error('temporary failure');
  }));
  const recovered = await ensureDatabaseOnce(retryDb, 'retry-key', async () => {
    attempts += 1;
    return 'recovered';
  });
  assert.equal(recovered, 'recovered');
  assert.equal(attempts, 2);
});

test('shared scheduled collectors start independently and isolate failures', async () => {
  const started = [];
  let releaseSlow;
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const configs = [
    { method: 'slow', run: async () => {} },
    { method: 'fast', run: async () => {} },
    { method: 'broken', run: async () => {} },
  ];

  const task = runScheduledConfigs({}, configs, 'shared-cron', async (_env, config) => {
    started.push(config.method);
    assert.equal(config.deferFeedMaintenance, false);
    assert.ok(config.collectionSeenKeys instanceof Set);
    if (config.method === 'slow') await slowGate;
    if (config.method === 'broken') throw new Error('collector failed');
    return config.method;
  });

  await Promise.resolve();
  assert.deepEqual(started, ['slow', 'fast', 'broken']);
  releaseSlow();
  assert.deepEqual(await task, ['slow', 'fast', null]);
});
