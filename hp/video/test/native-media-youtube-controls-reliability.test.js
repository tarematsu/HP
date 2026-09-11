import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const base = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const trustedInput = readFileSync(
  new URL('../../native/src/renderer_panels/media_trusted_input.inc', import.meta.url), 'utf8');
const recovery = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url), 'utf8');
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

test('YouTube watchdog self-heals lost and stale ExecuteScript callbacks', () => {
  assert.match(host, /kYoutubeWatchdogTimeoutMs = 5ULL \* 1000ULL/);
  assert.match(host, /uint64_t youtubeWatchdogRequestGeneration_ = 0/);
  assert.match(host, /ULONGLONG youtubeWatchdogStartedTick_ = 0/);
  assert.match(
    host,
    /youtubeWatchdogInFlight_[\s\S]*youtubeWatchdogStartedTick_[\s\S]*kYoutubeWatchdogTimeoutMs[\s\S]*InvalidateYoutubeWatchdog\(\)/,
  );
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

test('YouTube content recovery keeps play before fullscreen', () => {
  const paused = recovery.indexOf('video && video.paused && !video.ended');
  const contentFullscreen = recovery.lastIndexOf("player.querySelector('.ytp-fullscreen-button')");
  assert.ok(paused >= 0);
  assert.ok(contentFullscreen > paused);
  assert.match(recovery, /trusted\.arm\(play, 'play', 1500\)/);
  assert.match(recovery, /trusted\.arm\(target, 'fullscreen', 1200\)/);
});
