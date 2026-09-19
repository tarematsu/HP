import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const helper = source('webview_playback_resource_mode.h');
const stationheadFlag = source('stationhead_playback_resource_flag.h');
const stationheadHeader = source('sh.h');
const stationhead = source('sh.cpp');
const sharedEnvironment = source('shared_webview_environment.cpp');
const spotifyHeader = source('spotify_webviews.h');
const spotifyPolicy = source('spotify_runtime_policy.inc');
const spotifyPhase = source('spotify_phase_sync.inc');

test('playback resource mode targets only the owning WebView renderer', () => {
  assert.match(helper, /ICoreWebView2_20/);
  assert.match(helper, /get_FrameId\(&frameId\)/);
  assert.match(helper, /ICoreWebView2Environment13/);
  assert.match(helper, /GetProcessExtendedInfos/);
  assert.match(helper, /COREWEBVIEW2_PROCESS_KIND_RENDERER/);
  assert.match(helper, /get_AssociatedFrameInfos/);
  assert.match(helper, /FrameInfoCollectionContainsFrame\(frames\.Get\(\), frameId\)/);
  assert.match(helper, /BELOW_NORMAL_PRIORITY_CLASS/);
  assert.match(helper, /NORMAL_PRIORITY_CLASS/);
  assert.match(helper, /PROCESS_POWER_THROTTLING_EXECUTION_SPEED/);
  assert.doesNotMatch(sharedEnvironment, /SetWebViewRendererEfficiencyMode/);
  assert.doesNotMatch(sharedEnvironment, /SetWindowsProcessEfficiencyMode/);
});

test('stale asynchronous efficiency-mode requests cannot override a newer state', () => {
  assert.match(helper, /BeginPlaybackResourceModeChange/);
  assert.match(helper, /PlaybackResourceModeChangeIsCurrent/);
  assert.match(
    helper,
    /GetProcessExtendedInfos\([\s\S]*PlaybackResourceModeChangeIsCurrent\([\s\S]*generation, expectedGeneration\)/,
  );
  assert.match(spotifyHeader, /resourceModeGeneration/);
  assert.match(
    spotifyPolicy,
    /BeginPlaybackResourceModeChange\(slot\.resourceModeGeneration\)[\s\S]*SetWebViewRendererEfficiencyMode\([\s\S]*slot\.resourceModeGeneration, generation/,
  );
});

test('memory target is NORMAL before playback and LOW only when constrained', () => {
  assert.match(helper, /constrained \? COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW[\s\S]*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/);
  assert.match(spotifyPolicy, /SetWebViewPlaybackMemoryTarget\(slot\.webview\.Get\(\), constrained\)/);
  assert.match(spotifyPhase, /state == SlotState::Playing && slot\.playbackConfirmed &&[\s\S]*slot\.nativeAudioStartVerified/);
});

test('Stationhead releases LOW and efficiency mode at every navigation start', () => {
  assert.match(stationheadHeader, /#include "stationhead_playback_resource_flag\.h"/);
  assert.match(stationheadHeader, /StationheadPlaybackResourceFlag resourceBlockingArmed_/);
  assert.match(stationheadFlag, /add_NavigationStarting/);
  assert.match(stationheadFlag, /store\(false, std::memory_order_release\)/);
  assert.match(stationheadFlag, /BeginPlaybackResourceModeChange\(generation_\)/);
  assert.match(stationheadFlag, /SetWebViewPlaybackMemoryTarget\(webview_->Get\(\), constrained\)/);
  assert.match(stationheadFlag, /SetWebViewRendererEfficiencyMode\([\s\S]*generation_, generation/);
  assert.match(stationhead, /resourceBlockingArmed_ = true/);
  assert.match(stationhead, /resourceBlockingArmed_ = false/);
});
