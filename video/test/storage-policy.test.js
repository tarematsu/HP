import assert from 'node:assert/strict';
import test from 'node:test';

import { extractVideoUrls } from '../src/extractor.js';
import { PLAYBACK_FEED_LIMIT } from '../src/source-feed-unlimited.js';
import { buildSiteStatus } from '../src/status.js';

const HOST = 'media.example.test';

test('extractVideoUrls is not capped at 2000 items', () => {
  const input = Array.from(
    { length: 2505 },
    (_, index) => `https://${HOST}/video-${index}.mp4`
  ).join('\n');
  assert.equal(extractVideoUrls(input, undefined, HOST).length, 2505);
});

test('status distinguishes stored URLs from playback candidates', () => {
  const result = buildSiteStatus({}, []);
  assert.equal(result.storagePolicy.storedUrlLimit, null);
  assert.equal(result.storagePolicy.playbackFeedLimit, PLAYBACK_FEED_LIMIT);
});
