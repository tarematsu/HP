import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const guard = readFileSync(
  new URL('../../native/src/spotify_lonesome_guard.inc', import.meta.url),
  'utf8',
);

test('Spotify robust music checks the actual now-playing title before accepting playback', () => {
  assert.match(wrapper, /spotify_lonesome_guard\.inc/);
  assert.match(wrapper, /#define ExecuteScript\(script, callback\)/);
  assert.match(wrapper, /RewriteSpotifyPhaseExecuteScript/);
  assert.match(guard, /const targetTitle = 'lonesome rabbit'/);
  assert.match(guard, /now-playing-widget/);
  assert.match(guard, /context-item-link/);
  assert.match(guard, /currentTitle !== targetTitle/);
  assert.match(guard, /return point\(targetButton\)/);
});

test('wrong queue items are corrected from the Lonesome rabbit album row and repeat-one is retained', () => {
  assert.match(guard, /a\[href\*="\/track\/"\]/);
  assert.match(guard, /tracklist-row/);
  assert.match(guard, /ensureRepeatOne/);
  assert.match(guard, /checked === 'mixed'/);
  assert.match(guard, /spotify:not-playing/);
  assert.match(guard, /2f2Ik9JeinFVWZuFb3i35b/);
});
