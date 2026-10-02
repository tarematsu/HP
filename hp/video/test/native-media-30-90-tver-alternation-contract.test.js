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
const tverRuntime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const tverQueue = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');
const youtubeRuntime = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);

test('media cadence keeps zero to two two-minute X slots with variable YouTube and TVer durations', () => {
  assert.match(mediaBase, /kNativeMediaXPhaseMs = 2U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaStartupXPhaseMs = 2U \* 60U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaYoutubeMinContentDurationMinutes = 45U/);
  assert.match(mediaBase, /kNativeMediaYoutubeMaxContentDurationMinutes = 75U/);
  assert.match(mediaBase, /kNativeMediaTverMinContentDurationMinutes = 45U/);
  assert.match(mediaBase, /kNativeMediaTverMaxContentDurationMinutes = 75U/);
  assert.match(mediaBase, /NativeMediaCurrentYoutubeContentDurationMs\(\)/);
  assert.match(mediaBase, /NativeMediaCurrentTverContentDurationMs\(\)/);
  assert.match(mediaBase, /const UINT count = NativeMediaXRandomBelow\(3\)/);
  assert.match(mediaBase, /else if \(count == 1\)/);
  assert.match(mediaBase, /NativeMediaXSlotEnabled\(true\)/);
  assert.match(mediaBase, /NativeMediaXSlotEnabled\(false\)/);
  assert.match(mediaBase, /NativeMediaPhaseIntervalMs\(phase_ == Phase::Tver\)/);
  assert.match(mediaBase, /NativeMediaYoutubeContentIntervalMs\(\)/);
  assert.match(mediaBase, /NativeMediaTverContentIntervalMs\(\)/);
  assert.match(mediaBase, /NativeMediaYoutubeNavigationUrl\(\)/);
  assert.match(mediaBase, /https:\/\/x\.com\/home\?homepanel=startup/);
  assert.match(mediaBase, /gNativeMediaPowerSaving[\s\S]*NativeMediaStartupXDeadlineTick\(\)[\s\S]*return kNativeMediaYoutubeContentPhaseMs/);
  assert.doesNotMatch(mediaBase, /kNativeMediaTverWeekdayPhaseMs/);
  assert.doesNotMatch(mediaBase, /NativeMediaTverPhaseIntervalMs/);
  assert.doesNotMatch(mediaBase, /NetworkClockJstNow/);
  assert.match(mediaHost, /SetSpotifyMediaPhase\(phase_ == Phase::Tver\)/);
  assert.doesNotMatch(composition, /PhaseOverrideMs/);
});

test('TVer uses one watchdog routing key', () => {
  assert.doesNotMatch(mediaBase, /kNativeMediaTverLoopScript\[\]/);
  assert.match(mediaBase, /kNativeMediaTverWatchdogScript\[\]/);
  assert.match(mediaBase, /homepanel-tver-watchdog-routing-key/);
  assert.doesNotMatch(mediaWrapper, /media_tver_ad_guard\.inc/);
});

test('TVer queue, progression and cycle restart are native-owned', () => {
  assert.match(tverQueue, /struct NativeMediaTverNativeQueueState/);
  assert.match(tverQueue, /NativeMediaTverRebuildQueueLocked/);
  assert.match(tverQueue, /NativeMediaTverAdvanceEpisode/);
  assert.match(tverQueue, /Queue exhaustion starts a fresh cycle/);
  assert.match(mediaWrapper, /homepanel:tver-ended/);
  assert.doesNotMatch(tverRuntime, /episodeQueueKey|advanceEpisode|sessionStorage|location\.replace/);
  assert.doesNotMatch(composition, /AdvanceNativeMediaTverSeries|gNativeMediaTverUseDeathGame/);
});

test('TVer is event driven and player-local through one control runtime', () => {
  assert.match(tverRuntime, /window\.__homePanelTverRuntime/);
  assert.match(tverRuntime, /video\.defaultPlaybackRate = 1\.75/);
  assert.match(tverRuntime, /state\.playerObserver = new MutationObserver/);
  assert.match(tverRuntime, /state\.playerObserver\.observe\(player/);
  assert.match(tverRuntime, /state\.videoAbort = new AbortController/);
  assert.match(tverRuntime, /homepanel:tver-media-init/);
  assert.match(tverRuntime, /homepanel:tver-ended/);
  assert.doesNotMatch(tverRuntime, /observe\(document\.(?:documentElement|body)/);
  assert.doesNotMatch(tverRuntime, /setInterval\(/);
  assert.match(tverRuntime, /'ratechange'/);
  assert.doesNotMatch(tverRuntime, /qualityProbeIntervalMs|qualityProbeLimit|qualityProbeAttempts|qualityProbeAt/);
});

test('hidden YouTube and TVer share direct CSS WebView2 trusted input', () => {
  assert.match(mediaWrapper, /#include "media_trusted_input\.inc"/);
  assert.match(mediaHost, /void DispatchMediaCssPoint\(/);
  assert.match(mediaHost, /Input\.dispatchMouseEvent/);
  assert.match(mediaHost, /DispatchMediaCssPoint\(requestView\.Get\(\), cssX, cssY, false\)/);
  assert.match(mediaHost, /DispatchMediaCssPoint\(requestView\.Get\(\), cssX, cssY, true\)/);
  assert.match(mediaHost, /kNativeMediaTverForceFullscreenAdSafeScript/);
  assert.doesNotMatch(
    mediaHost.slice(
      mediaHost.indexOf('void DispatchMediaCssPoint('),
      mediaHost.indexOf('void ProbeYoutubeWatchdog()'),
    ),
    /ClientToScreen|ScreenToClient|MOUSEEVENTF_|GetDpiForWindow|get_ZoomFactor|get_RasterizationScale/,
  );
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

test('YouTube health uses a 30-second backstop plus unified event wakeups', () => {
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogHealthyMs = 30U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(mediaWrapper, /#include "media_youtube_control_recovery\.inc"/);
  assert.match(youtubeRuntime, /homepanel:youtube-wake/);
  assert.match(youtubeRuntime, /attributeFilter: \['class'\]/);
  assert.match(mediaWrapper, /homepanel:youtube-wake/);
  assert.doesNotMatch(mediaWrapper, /kNativeMediaYoutubeHealthScript|kNativeMediaYoutubeHealthPolicyScript/);
});

test('TVer episode navigation keeps the existing controller and profile', () => {
  assert.match(mediaHost, /NativeMediaTverCurrentEpisodeUrl\(hostWindow_, alive_\)/);
  assert.match(mediaHost, /webview_->Navigate\(url\.c_str\(\)\)/);
  assert.doesNotMatch(mediaHost, /ClearBrowsingData|COREWEBVIEW2_BROWSING_DATA_KINDS/);
});
