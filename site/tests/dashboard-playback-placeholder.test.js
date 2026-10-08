import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeQueueTrackMetadata } from '../../worker/src/track-metadata-quality.js';

test('dashboard queue metadata does not let placeholder titles mask display metadata', () => {
  const queue = sanitizeQueueTrackMetadata({
    tracks: [{
      title: '曲名...',
      artist: '櫻坂46',
      display_title: '承認欲求 — 櫻坂46',
      duration_ms: 238000,
    }],
  });
  assert.equal(queue.tracks[0].title, '承認欲求');
  assert.equal(queue.tracks[0].artist, '櫻坂46');
});
