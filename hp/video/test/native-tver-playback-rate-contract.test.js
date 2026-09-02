import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mediaPanel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('TVer Sakura Meets playback is kept at 1.75x after media element changes', () => {
  assert.match(mediaPanel, /const playbackRate = 1\.75/);
  assert.match(mediaPanel, /video\.defaultPlaybackRate = playbackRate/);
  assert.match(
    mediaPanel,
    /if \(video\.playbackRate !== playbackRate\) video\.playbackRate = playbackRate/,
  );
  assert.match(mediaPanel, /window\.setInterval\(ensure, 2000\)/);
});
