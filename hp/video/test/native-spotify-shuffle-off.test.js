import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url), 'utf8');
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const guard = readFileSync(
  new URL('../../native/src/spotify_shuffle_off.inc', import.meta.url), 'utf8');
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');

test('Spotify music verifies native Web Player shuffle is off before playback reconcile', () => {
  assert.match(wrapper, /#include "spotify_shuffle_off\.inc"/);
  assert.match(header, /bool shuffleOffVerified = false;/);
  assert.match(header, /bool EnsureShuffleOff\(Slot& slot\) noexcept;/);
  assert.match(guard, /control-button-shuffle/);
  assert.match(guard, /getAttribute\('aria-checked'\) !== 'true'/);
  assert.match(guard, /ClickSlotNormalizedPoint\(\*target, x, y\)/);
  assert.doesNotMatch(guard, /\.click\(\)/);
  assert.match(music, /slot\.shuffleOffVerified = false;/);
  assert.match(music, /if \(!EnsureShuffleOff\(slot\)\) return;/);
  assert.match(
    music,
    /EnsureShuffleOff\(slot\)[\s\S]*kSpotifyStaticTrackReconcileScript/,
  );
});
