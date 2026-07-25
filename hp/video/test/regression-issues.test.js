import assert from 'node:assert/strict';
import test from 'node:test';

import { videoShuffleKey } from '../src/playback-feed.js';
import { inferVideoOrientation } from '../src/video-orientation.js';

test('orientation uses the final adjacent dimension segment', () => {
  assert.equal(
    inferVideoOrientation('https://cdn.example/640x360/720x1280/video.mp4'),
    'vertical'
  );
});

test('shuffle key stays exact for ids beyond Number safe integer range', () => {
  const id = '9007199254740993';
  const expected = Number((BigInt(id) * 1_103_515_245n) % 2_147_483_647n);
  assert.equal(videoShuffleKey(id), expected);
});
