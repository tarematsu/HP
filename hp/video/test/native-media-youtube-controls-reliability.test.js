import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const base = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url),
  'utf8',
);
const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
  'utf8',
);
const trustedInput = readFileSync(
  new URL('../../native/src/renderer_panels/media_trusted_input.inc', import.meta.url),
  'utf8',
);
const youtubePolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
  'utf8',
);

test('YouTube uses one adaptive watchdog with healthy and recovery cadence', () => {
  assert.match(base, /kNativeMediaYoutubeWatchdogHealthyMs = 10U \* 1000U/);
  assert.match(base, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(
    host,
    /kNativeMediaYoutubeWatchdogTimer[\s\S]*kNativeMediaYoutubeWatchdogHealthyMs/,
  );
  assert.match(host, /ProbeYoutubeWatchdog/);
  assert.doesNotMatch(base + host, /kNativeMediaYoutubeControlWatchdogMs|kNativeMediaYoutubeHealthTimer/);
});

test('trusted WebView2 clicks convert raw Win32 coordinates to CSS pixels', () => {
  assert.match(trustedInput, /ICoreWebView2Controller3/);
  assert.match(trustedInput, /get_RasterizationScale/);
  assert.match(trustedInput, /GetDpiForWindow/);
  assert.match(trustedInput, /get_ZoomFactor/);
  assert.match(trustedInput, /point\.x\) \/ cssScale/);
  assert.match(trustedInput, /point\.y\) \/ cssScale/);
  assert.match(wrapper, /controller_\.Get\(\), hostWindow_/);
});

test('trusted click waits for mouse move before press and release', () => {
  const moved = trustedInput.indexOf('L"mouseMoved"');
  const moveCallback = trustedInput.indexOf('HRESULT moveResult');
  const pressed = trustedInput.indexOf('L"mousePressed"', moveCallback);
  const released = trustedInput.indexOf('L"mouseReleased"', pressed);
  assert.ok(moved >= 0);
  assert.ok(moveCallback > moved);
  assert.ok(pressed > moveCallback);
  assert.ok(released > pressed);
});

test('YouTube skip detection covers current class and aria-label variants', () => {
  assert.match(youtubePolicy, /\.ytp-ad-skip-button/);
  assert.match(youtubePolicy, /\.ytp-ad-skip-button-modern/);
  assert.match(youtubePolicy, /\.ytp-skip-ad-button/);
  assert.match(youtubePolicy, /button\[aria-label\*=\"Skip ad\" i\]/);
  assert.match(youtubePolicy, /button\[aria-label\*=\"広告をスキップ\"\]/);
  assert.match(youtubePolicy, /button\[aria-label\*=\"スキップ\"\]/);
  assert.match(youtubePolicy, /player\.classList\.contains\('ad-showing'\)/);
  assert.match(youtubePolicy, /if \(adShowing\) return null/);
});

test('YouTube playback recovery still prioritizes play before fullscreen', () => {
  const paused = youtubePolicy.indexOf('video.paused && !video.ended');
  const fullscreen = youtubePolicy.indexOf('document.fullscreenElement');
  assert.ok(paused >= 0);
  assert.ok(fullscreen > paused);
  assert.match(youtubePolicy, /\.ytp-play-button/);
  assert.match(youtubePolicy, /\.ytp-fullscreen-button/);
});
