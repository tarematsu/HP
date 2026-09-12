import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url), 'utf8');
const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const mediaWrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const trustedInput = readFileSync(
  new URL('../../native/src/renderer_panels/media_trusted_input.inc', import.meta.url), 'utf8');
const tverKeys = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url), 'utf8');
const tverEpisode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const tverQueue = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');
const youtubeAgent = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_event_agent.inc', import.meta.url), 'utf8');

test('media cadence remains 60 minutes per YouTube/TVer phase', () => {
  assert.match(mediaBase, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaHost, /SetSpotifyMediaPhase\(phase_ == Phase::Tver\)/);
  assert.doesNotMatch(composition, /PhaseOverrideMs/);
});

test('TVer old static implementation is reduced to routing keys', () => {
  assert.match(tverKeys, /kNativeMediaTverLoopStaticScript\[\]/);
  assert.match(tverKeys, /kNativeMediaTverWatchdogStaticScript\[\]/);
  assert.match(tverKeys, /homepanel-tver-loop-routing-key/);
  assert.match(tverKeys, /homepanel-tver-watchdog-routing-key/);
  assert.doesNotMatch(tverKeys, /MutationObserver|querySelectorAll|playbackRate/);
});

test('TVer queue, progression and cycle restart are native-owned', () => {
  assert.match(tverQueue, /struct NativeMediaTverNativeQueueState/);
  assert.match(tverQueue, /NativeMediaTverRebuildQueueLocked/);
  assert.match(tverQueue, /NativeMediaTverAdvanceEpisode/);
  assert.match(tverQueue, /Queue exhaustion starts a fresh cycle/);
  assert.match(mediaWrapper, /homepanel:tver-ended/);
  assert.doesNotMatch(tverEpisode, /episodeQueueKey|advanceEpisode|sessionStorage|location\.replace/);
  assert.doesNotMatch(composition, /AdvanceNativeMediaTverSeries|gNativeMediaTverUseDeathGame/);
});

test('TVer is event driven and player-local', () => {
  assert.match(tverEpisode, /const playbackRate = 1\.75/);
  assert.match(tverEpisode, /const bindPlayerObserver = video =>/);
  assert.match(tverEpisode, /playerObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.match(tverEpisode, /event\.target instanceof HTMLMediaElement/);
  assert.match(tverEpisode, /homepanel:tver-media-init/);
  assert.match(tverEpisode, /homepanel:tver-ended/);
  assert.doesNotMatch(tverEpisode, /observe\(document\.(?:documentElement|body)/);
  assert.doesNotMatch(tverEpisode, /setInterval\(ensure/);
  assert.doesNotMatch(tverEpisode, /addEventListener\('ratechange'/);
  assert.doesNotMatch(tverEpisode, /qualityProbeIntervalMs|qualityProbeLimit|qualityProbeAttempts|qualityProbeAt/);
});

test('hidden YouTube and TVer share one WebView2 trusted-input path', () => {
  assert.match(mediaWrapper, /#include "media_trusted_input\.inc"/);
  assert.match(mediaHost, /NativeMediaDispatchTrustedInput/);
  assert.match(trustedInput, /CallDevToolsProtocolMethod/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
  assert.doesNotMatch(trustedInput, /::SendInput\(/);
});

test('TVer media wake is one-shot and the steady watchdog stays low frequency', () => {
  assert.match(mediaWrapper, /homepanel:tver-media-init/);
  assert.match(mediaWrapper, /NativeMediaTrustedWake\(hostWindow, sender, nullptr\)/);
  assert.match(trustedInput, /return ::SetTimer\(hwnd, timerId, steadyIntervalMs, nullptr\)/);
  assert.doesNotMatch(
    trustedInput,
    /kNativeMediaTrustedWakeIntervalMs|kNativeMediaTrustedWakeAttempts|NativeMediaTrustedWakeTimerProc/,
  );
  assert.match(mediaBase, /kNativeMediaTverWatchdogMs = 30U \* 1000U/);
});

test('YouTube health uses a 30-second backstop plus event wakeups', () => {
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogHealthyMs = 30U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(mediaWrapper, /#include "media_youtube_control_recovery\.inc"/);
  assert.match(mediaWrapper, /#include "media_youtube_event_agent\.inc"/);
  assert.match(youtubeAgent, /homepanel:youtube-wake/);
  assert.match(mediaWrapper, /homepanel:youtube-wake/);
  assert.doesNotMatch(mediaWrapper, /kNativeMediaYoutubeHealthScript|kNativeMediaYoutubeHealthPolicyScript/);
});

test('TVer episode navigation keeps the existing controller and profile', () => {
  assert.match(mediaHost, /NativeMediaTverCurrentEpisodeUrl\(hostWindow_, alive_\)/);
  assert.match(mediaHost, /webview_->Navigate\(url\.c_str\(\)\)/);
  assert.doesNotMatch(mediaHost, /ClearBrowsingData|COREWEBVIEW2_BROWSING_DATA_KINDS/);
});
