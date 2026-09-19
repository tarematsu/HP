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

test('isolated WebView2 Audio Service exits recover only the reporting Spotify slot', () => {
  assert.match(recovery, /COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED/);
  assert.match(recovery, /ICoreWebView2ProcessFailedEventArgs2/);
  assert.match(recovery, /get_ProcessDescription/);
  assert.match(recovery, /audio service/);
  assert.match(recovery, /kSpotifyAudioServiceRecoveryDelayMs = 2ULL \* 1000ULL/);
  assert.match(recovery, /slot\.mediaNetworkRecoveryPending = true/);
  assert.match(recovery, /slot\.mediaNetworkRecoveryTick =/);
  assert.match(recovery, /SetSlotState\(slot, SlotState::Recovering\)/);
  assert.match(recovery, /slot\.nextRecoveryTick = slot\.mediaNetworkRecoveryTick/);
  assert.doesNotMatch(recovery, /for \(Slot& target : slots_\)/);
  assert.doesNotMatch(recovery, /kSpotifyAudioServiceRecoveryLaneSpacingMs/);
  assert.doesNotMatch(recovery, /gSpotifyAudioServiceRecoveryLastTick/);
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
