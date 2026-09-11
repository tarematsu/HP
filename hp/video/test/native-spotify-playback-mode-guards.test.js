import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url), 'utf8');
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const guards = readFileSync(
  new URL('../../native/src/spotify_playback_mode_guards.inc', import.meta.url), 'utf8');
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');

test('Spotify music converges both shuffle and repeat to off before playback reconcile', () => {
  assert.match(wrapper, /#include "spotify_playback_mode_guards\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_shuffle_off\.inc/);
  assert.match(header, /enum class PlaybackModeGuard/);
  assert.match(header, /bool shuffleOffVerified = false;/);
  assert.match(header, /bool repeatOffVerified = false;/);
  assert.match(header, /bool EnsurePlaybackModeOff\(/);
  assert.match(guards, /kSpotifyPlaybackModesOffProbeScript/);
  assert.match(guards, /control-button-shuffle/);
  assert.match(guards, /control-button-repeat/);
  assert.match(guards, /checked === 'false'/);
  assert.match(guards, /\['true', 'mixed'\]/);
  assert.match(guards, /target->shuffleOffVerified = true;/);
  assert.match(guards, /target->repeatOffVerified = true;/);
  assert.match(guards, /ClickSlotNormalizedPoint\(\*target, x, y\)/);
  assert.doesNotMatch(guards, /\.click\(\)/);
  assert.match(music, /slot\.shuffleOffVerified = false;/);
  assert.match(music, /slot\.repeatOffVerified = false;/);
  assert.match(music, /PlaybackModeGuard::Shuffle/);
  assert.match(music, /PlaybackModeGuard::Repeat/);
  assert.match(
    music,
    /PlaybackModeGuard::Shuffle[\s\S]*PlaybackModeGuard::Repeat[\s\S]*kSpotifyStaticTrackReconcileScript/,
  );
});

test('shuffle and repeat are inspected in one JavaScript round trip', () => {
  assert.equal(
    (guards.match(/ExecuteScript\(\s*kSpotifyPlaybackModesOffProbeScript/g) || []).length,
    1,
  );
  assert.doesNotMatch(guards, /kSpotifyShuffleOffProbeScript|kSpotifyRepeatOffProbeScript/);
  assert.match(guards, /const shuffle = inspect\('control-button-shuffle', \['true'\]\)/);
  assert.match(guards, /const repeat = inspect\('control-button-repeat', \['true', 'mixed'\]\)/);
  assert.match(guards, /return shuffle\.off && repeat\.off/);
});

test('unmounted controls stay pending instead of being falsely marked off or unhealthy', () => {
  assert.match(guards, /if \(!button\) return \{ off: false, point: null \}/);
  assert.match(guards, /if \(value == L"false"\)/);
  assert.match(guards, /ArmRobustScheduler\(\);[\s\S]*return S_OK;/);
});
