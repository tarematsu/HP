import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSameOriginPlaybackBlockRequest,
  normalizeExcludedMediaUrl
} from '../src/video-blocklist.js';

test('action request validation accepts only matching origin and marker', () => {
  const accepted = new Request('https://app.example.test/api/action', {
    method: 'POST',
    headers: {
      origin: 'https://app.example.test',
      'x-videoscraper-action': 'block'
    }
  });
  const rejected = new Request('https://app.example.test/api/action', {
    method: 'POST',
    headers: {
      origin: 'https://other.example.test',
      'x-videoscraper-action': 'block'
    }
  });

  assert.equal(isSameOriginPlaybackBlockRequest(accepted), true);
  assert.equal(isSameOriginPlaybackBlockRequest(rejected), false);
});

test('media normalization uses host and path as a stable key', () => {
  const result = normalizeExcludedMediaUrl(
    'https://media.example.test/video/a.mp4?variant=2',
    'media.example.test'
  );
  assert.equal(result.canonicalKey, 'media.example.test/video/a.mp4');
});
