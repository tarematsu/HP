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
const phaseSync = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
  'utf8',
);

test('Spotify robust music checks the actual now-playing title before accepting playback', () => {
  assert.match(wrapper, /spotify_lonesome_guard\.inc/);
  assert.match(wrapper, /#define ExecuteScript\(script, callback\)/);
  assert.match(wrapper, /RewriteSpotifyPhaseExecuteScript/);
  assert.match(guard, /const targetTitle = 'lonesome rabbit'/);
  assert.match(guard, /now-playing-widget/);
  assert.match(guard, /context-item-link/);
  assert.match(guard, /navigator\.mediaSession/);
  assert.match(guard, /currentTitle !== targetTitle/);
  assert.match(guard, /return point\(targetButton\)/);
});

test('repeat-one must be verified before a Lonesome rabbit slot becomes healthy', () => {
  assert.match(guard, /checked === 'mixed'/);
  assert.match(guard, /const repeatAction = \(\) =>/);
  assert.match(guard, /if \(state === 'one'\) return true/);
  assert.match(guard, /if \(state === 'unknown'\) return null/);
  assert.match(guard, /return point\(repeat\)/);
  assert.match(guard, /if \(repeat !== true\) \{[\s\S]*report\(false\);[\s\S]*return repeat;/);
  assert.doesNotMatch(guard, /repeat\.click\(\)/);
});

test('repeat control points flow through the existing trusted native click path', () => {
  assert.match(phaseSync, /ParseNormalizedPoint\(json, &x, &y\)/);
  assert.match(phaseSync, /ClickSlotNormalizedPoint\(\*target, x, y\)/);
  assert.match(phaseSync, /SendInput\(count, inputs, sizeof\(INPUT\)\)/);
});

test('wrong queue items are corrected from the Lonesome rabbit album row', () => {
  assert.match(guard, /a\[href\*="\/track\/"\]/);
  assert.match(guard, /tracklist-row/);
  assert.match(guard, /spotify:not-playing/);
  assert.match(guard, /2f2Ik9JeinFVWZuFb3i35b/);
});
