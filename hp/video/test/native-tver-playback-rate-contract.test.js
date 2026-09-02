import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);

test('TVer Sakura Meets playback is kept at 1.75x after media element changes', () => {
  assert.match(composition, /const playbackRate = 1\.75/);
  assert.match(composition, /video\.defaultPlaybackRate = playbackRate/);
  assert.match(
    composition,
    /if \(video\.playbackRate !== playbackRate\) video\.playbackRate = playbackRate/,
  );
  assert.match(composition, /window\.setInterval\(ensure, 2000\)/);
});
