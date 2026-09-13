import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const base = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const trustedInput = readFileSync(
  new URL('../../native/src/renderer_panels/media_trusted_input.inc', import.meta.url), 'utf8');
const recovery = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);
const agent = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_event_agent.inc', import.meta.url), 'utf8');

test('YouTube steady watchdog is low-frequency and event assisted', () => {
  assert.match(base, /kNativeMediaYoutubeWatchdogHealthyMs = 30U \* 1000U/);
  assert.match(base, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(host, /ProbeYoutubeWatchdog/);
  assert.match(agent, /homepanel:youtube-wake/);
  assert.match(wrapper, /add_WebMessageReceived/);
  assert.doesNotMatch(base + host, /kNativeMediaYoutubeControlWatchdogMs|kNativeMediaYoutubeHealthTimer/);
});

test('the one active media WebView uses one stale-callback watchdog state', () => {
  assert.match(host, /kWatchdogTimeoutMs = 5ULL \* 1000ULL/);
  assert.match(host, /uint64_t watchdogGeneration_ = 0/);
  assert.match(host, /ULONGLONG watchdogStartedTick_ = 0/);
  assert.match(host, /bool watchdogInFlight_ = false/);
  assert.match(host, /BeginWatchdogProbe/);
  assert.match(host, /FinishWatchdogProbe/);
  assert.doesNotMatch(host, /youtubeWatchdogRequestGeneration_|tverWatchdogRequestGeneration_/);
});

test('trusted WebView2 clicks convert raw Win32 coordinates to CSS pixels', () => {
  assert.match(trustedInput, /ICoreWebView2Controller3/);
  assert.match(trustedInput, /get_RasterizationScale/);
  assert.match(trustedInput, /get_ZoomFactor/);
  assert.match(trustedInput, /point\.x\) \/ cssScale/);
  assert.match(trustedInput, /point\.y\) \/ cssScale/);
});

test('YouTube skip detection remains player-local and variant tolerant', () => {
  assert.match(recovery, /\.ytp-ad-skip-button-modern/);
  assert.match(recovery, /\.ytp-skip-ad-button/);
  assert.match(recovery, /aria-label\*=\"Skip ad\" i/);
  assert.match(recovery, /aria-label\*=\"広告をスキップ\"/);
  assert.match(recovery, /player\.querySelectorAll\(skipSelectors\.join\(','\)\)/);
  assert.doesNotMatch(recovery, /document\.querySelectorAll\(skipSelectors/);
});

test('YouTube message dialogs use the same scoped observer as player state', () => {
  assert.match(agent, /closePattern = \/\^\(閉じる\|close\)\$\/i/);
  assert.match(agent, /document\.querySelector\('ytd-popup-container'\)/);
  assert.match(agent, /state\.observer\.observe\(popupContainer/);
  assert.match(agent, /state\.observer\.observe\(player/);
  assert.match(agent, /close\.click\(\)/);
  assert.match(agent, /isSurveyDialog/);
  assert.match(agent, /root\?\.querySelector\?\.\(surveyDialogMarkerSelector\)/);
  assert.doesNotMatch(agent, /popupObserver|classObserver/);
});

test('YouTube content recovery retries fullscreen until actual entry is confirmed', () => {
  const paused = recovery.indexOf('video && video.paused');
  const confirmed = recovery.lastIndexOf('if (trusted.fullscreen())');
  const contentFullscreen = recovery.lastIndexOf("player.querySelector('.ytp-fullscreen-button')");
  const arm = recovery.lastIndexOf("trusted.arm(target, 'fullscreen', 1200)");
  assert.ok(paused >= 0);
  assert.ok(confirmed > paused);
  assert.ok(contentFullscreen > confirmed);
  assert.ok(arm > contentFullscreen);
  assert.match(recovery, /trusted\.arm\(play, 'play', 1500\)/);
  assert.match(
    recovery,
    /if \(trusted\.fullscreen\(\)\) \{\s*recoveryState\.fullscreenApplied = true;\s*return null;/,
  );
  assert.match(recovery, /if \(recoveryState\.fullscreenApplied\) return null/);
  assert.doesNotMatch(
    recovery,
    /fullscreenAction[\s\S]{0,160}recoveryState\.fullscreenApplied = true/,
  );
  assert.match(recovery, /return trusted\.arm\(target, 'fullscreen', 1200\)/);
});

test('YouTube stalled playback retries once then advances the playlist', () => {
  assert.match(recovery, /pauseEscalationMs = 10 \* 1000/);
  assert.match(recovery, /stallEscalationMs = 30 \* 1000/);
  assert.match(recovery, /playRetryAttempted/);
  assert.match(recovery, /advanceToNextPlaylistItem/);
  assert.match(recovery, /\.ytp-next-button\[href\]/);
  assert.match(recovery, /location\.assign\(candidate\.href\)/);
  assert.match(recovery, /typeof player\.nextVideo === 'function'/);
  assert.match(agent, /recoveryTimer/);
  assert.match(agent, /'waiting', 'stalled'/);
  assert.match(agent, /scheduleRecoveryWake\(10 \* 1000 \+ 500\)/);
  assert.match(agent, /scheduleRecoveryWake\(30 \* 1000 \+ 500\)/);
  assert.match(agent, /wake\(true\)/);
});
