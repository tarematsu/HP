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

test('Spotify starts target before post-start shuffle convergence', () => {
  assert.match(wrapper, /#include "spotify_playback_mode_guards\.inc"/);
  assert.match(header, /bool shuffleOffVerified = false;/);
  assert.match(header, /bool EnsureShuffleOff\(/);
  assert.doesNotMatch(header, /PlaybackModeGuard|repeatOffVerified/);
  assert.match(guards, /kSpotifyShuffleOffProbeScript/);
  assert.match(guards, /control-button-shuffle/);
  assert.doesNotMatch(guards, /control-button-repeat|repeatOffVerified|repeat one|disable repeat|enable repeat/i);
  assert.match(guards, /checked === 'false'/);
  assert.match(guards, /target->shuffleOffVerified = true;/);
  assert.match(guards, /DispatchSpotifyDevToolsClick\(\*target, x, y\)/);
  assert.doesNotMatch(guards, /ClickSlotNormalizedPoint/);
  assert.doesNotMatch(guards, /MarkSlotRecovering|RecomputeForeground/);
  assert.doesNotMatch(guards, /\.click\(\)/);
  assert.match(music, /slot\.shuffleOffVerified = false;/);
  assert.doesNotMatch(music, /repeatOffVerified|PlaybackModeGuard::Repeat|EnsurePlaybackModeOff/);

  const playingGate = music.indexOf('slot.state == SlotState::Playing');
  const shuffle = music.indexOf('EnsureShuffleOff(slot)', playingGate);
  const reconcile = music.indexOf('kSpotifyStaticTrackReconcileScript', shuffle);
  assert.ok(playingGate >= 0 && shuffle > playingGate && reconcile > shuffle);
});

test('healthy music stays renderable until shuffle is verified off', () => {
  assert.match(
    layout,
    /const bool healthyMusicReadyToHide =[\s\S]*TimedSpotifyTarget::Music[\s\S]*slot\.shuffleOffVerified/,
  );
  assert.doesNotMatch(layout, /repeatOffVerified/);
  assert.match(
    layout,
    /const bool lowPowerPlayback =[\s\S]*\(healthyMusicReadyToHide \|\| healthyPodcastReadyToHide\)/,
  );
  assert.match(
    layout,
    /put_IsVisible\(lowPowerPlayback \? FALSE : TRUE\)/,
  );
  assert.match(
    guards,
    /target->shuffleOffVerified = true;[\s\S]*PlaceHosts\(\)/,
  );
  assert.match(guards, /RefreshSpotifyHostLayout\(\) can legitimately early-return/);
});

test('shuffle uses one JavaScript probe and never inspects repeat', () => {
  assert.equal(
    (guards.match(/ExecuteScript\(\s*kSpotifyShuffleOffProbeScript/g) || []).length,
    1,
  );
  assert.match(guards, /control-button-shuffle/);
  assert.doesNotMatch(guards, /control-button-repeat|repeat one|disable repeat|enable repeat/i);
});

test('unmounted shuffle control stays pending without demoting confirmed playback', () => {
  assert.match(guards, /if \(!button\) return false/);
  assert.match(guards, /if \(value == L"false"\)/);
  assert.match(guards, /ArmRobustScheduler\(\);[\s\S]*return S_OK;/);
  assert.doesNotMatch(guards, /MarkSlotRecovering|RecomputeForeground/);
});
