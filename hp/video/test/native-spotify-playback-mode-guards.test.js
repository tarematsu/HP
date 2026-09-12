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
const layout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url), 'utf8');

test('Spotify starts target before post-start shuffle/repeat convergence', () => {
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
  assert.match(guards, /DispatchSpotifyDevToolsClick\(\*target, x, y\)/);
  assert.doesNotMatch(guards, /ClickSlotNormalizedPoint/);
  assert.doesNotMatch(guards, /MarkSlotRecovering|RecomputeForeground/);
  assert.doesNotMatch(guards, /\.click\(\)/);
  assert.match(music, /slot\.shuffleOffVerified = false;/);
  assert.match(music, /slot\.repeatOffVerified = false;/);

  const playingGate = music.indexOf('if (slot.state == SlotState::Playing)');
  const shuffle = music.indexOf('PlaybackModeGuard::Shuffle', playingGate);
  const repeat = music.indexOf('PlaybackModeGuard::Repeat', shuffle);
  const reconcile = music.indexOf('kSpotifyStaticTrackReconcileScript', repeat);
  assert.ok(
    playingGate >= 0 && shuffle > playingGate && repeat > shuffle && reconcile > repeat,
  );
});

test('healthy music stays renderable until shuffle and repeat are verified off', () => {
  assert.match(
    layout,
    /const bool healthyMusicReadyToHide =[\s\S]*TimedSpotifyTarget::Music[\s\S]*slot\.shuffleOffVerified && slot\.repeatOffVerified/,
  );
  assert.match(
    layout,
    /const bool suppressHealthyRendering =[\s\S]*\(healthyMusicReadyToHide \|\| healthyPodcastReadyToHide\)/,
  );
  assert.match(
    layout,
    /put_IsVisible\(suppressHealthyRendering \? FALSE : TRUE\)/,
  );
  assert.match(
    guards,
    /target->shuffleOffVerified = true;[\s\S]*target->repeatOffVerified = true;[\s\S]*PlaceHosts\(\)/,
  );
  assert.match(guards, /RefreshSpotifyHostLayout\(\) can legitimately early-return/);
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

test('unmounted controls stay pending without demoting confirmed playback', () => {
  assert.match(guards, /if \(!button\) return \{ off: false, point: null \}/);
  assert.match(guards, /if \(value == L"false"\)/);
  assert.match(guards, /ArmRobustScheduler\(\);[\s\S]*return S_OK;/);
  assert.doesNotMatch(guards, /MarkSlotRecovering|RecomputeForeground/);
});
