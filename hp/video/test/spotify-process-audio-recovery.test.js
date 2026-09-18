import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const header = source('spotify_webviews.h');
const foundation = source('spotify_webview_foundation.inc');
const recovery = source('spotify_process_failure.inc');
const wrapper = source('spotify_webviews.cpp');
const stationhead = source('sh_track_boundary_message_policy.h');

test('every Spotify WebView installs one process-failure monitor from mute setup', () => {
  assert.match(header, /EnsureProcessFailureMonitoring\(ICoreWebView2\* webview\)/);
  assert.match(foundation, /EnsureProcessFailureMonitoring\(webview\.Get\(\)\)/);
  assert.match(wrapper, /#include "spotify_process_failure\.inc"/);
  assert.match(recovery, /add_ProcessFailed\(/);
  assert.match(recovery, /gSpotifyProcessFailureRegisteredWebviews/);
});

test('shared WebView2 Audio Service exits recover every live Spotify lane', () => {
  assert.match(recovery, /COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED/);
  assert.match(recovery, /ICoreWebView2ProcessFailedEventArgs2/);
  assert.match(recovery, /get_ProcessDescription/);
  assert.match(recovery, /audio service/);
  assert.match(recovery, /kSpotifyAudioServiceRecoveryBaseDelayMs = 2ULL \* 1000ULL/);
  assert.match(recovery, /kSpotifyAudioServiceRecoveryLaneSpacingMs = 5ULL \* 1000ULL/);
  assert.match(recovery, /kSpotifyAudioServiceRecoveryDebounceMs = 10ULL \* 1000ULL/);
  assert.match(recovery, /gSpotifyAudioServiceRecoveryLastTick/);
  assert.match(recovery, /for \(Slot& target : slots_\)/);
  assert.match(recovery, /SpotifyRuntimeLaneForAccount\(target\.index\)/);
  assert.match(recovery, /CurrentMusicTrack\(target\)/);
  assert.match(recovery, /target\.mediaNetworkRecoveryPending = true/);
  assert.match(recovery, /target\.mediaNetworkRecoveryTick =/);
  assert.match(recovery, /SetSlotState\(target, SlotState::Recovering\)/);
  assert.match(recovery, /target\.nextRecoveryTick = target\.mediaNetworkRecoveryTick/);
});

test('fatal browser or renderer failures rebuild while transient process exits do not storm', () => {
  assert.match(recovery, /COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED/);
  assert.match(recovery, /COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED/);
  assert.match(recovery, /mediaPipelineRecoveryPending = true/);
  assert.match(recovery, /COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE/);
  assert.match(recovery, /count < 2/);
  assert.match(recovery, /GPU, sandbox-helper, frame-only and non-audio utility processes/);
});

test('Stationhead fifty-minute preventive reload remains unchanged', () => {
  assert.match(stationhead, /return 50 \* 60'000/);
  assert.match(stationhead, /L"50-minute periodic refresh"/);
});
