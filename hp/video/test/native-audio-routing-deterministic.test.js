import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url), 'utf8');

const appHeader = readNative('app.h');
const schedule = readNative('power_saving_schedule.inc');
const stationheadAudio = readNative('sh_audio.cpp');
const spotifyPhaseSync = readNative('spotify_phase_sync.inc');

function section(source, start) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  return source.slice(startAt);
}

test('Stationhead routing is fail-closed and SH selection is deterministic', () => {
  assert.match(appHeader, /bool stationheadAudioMuted_ = true/);

  const route = section(
    schedule,
    'void PowerSavingController::ApplyAudioMode(AudioMode mode) noexcept',
  );
  assert.match(
    route,
    /const UiAction stationheadAction = mode == AudioMode::Stationhead[\s\S]*UiAction::StationheadAudioToggle[\s\S]*UiAction::StationheadAudioMute/,
  );

  const normalizeMuteAt = route.indexOf(
    'static_cast<WPARAM>(UiAction::StationheadAudioMute)',
  );
  const selectedActionAt = route.indexOf(
    'static_cast<WPARAM>(stationheadAction)',
  );
  assert.notEqual(normalizeMuteAt, -1);
  assert.notEqual(selectedActionAt, -1);
  assert.ok(
    normalizeMuteAt < selectedActionAt,
    'Stationhead must normalize to muted before the legacy toggle un-mutes SH',
  );
});

test('Stationhead repairs WebView2 mute drift instead of trusting cached state', () => {
  assert.match(stationheadAudio, /get_IsMuted\(&current\)/);
  assert.match(stationheadAudio, /put_IsMuted\(desired\)/);
  assert.match(stationheadAudio, /get_IsMuted\(&confirmed\)/);
  assert.match(stationheadAudio, /applied \? desiredValue : -1/);
  assert.doesNotMatch(
    stationheadAudio,
    /appliedMuted_\.load\([^\n]*\) == [^\n]*return/,
  );
});

test('Spotify reasserts native mute routing whenever slot state changes', () => {
  const setSlotState = section(
    spotifyPhaseSync,
    'void SpotifyWebViews::SetSlotState(Slot& slot, SlotState state) noexcept',
  );
  assert.match(
    setSlotState,
    /if \(slot\.webview\) SetSpotifyOutputMuted\(slot\.webview\)/,
  );
});
