import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url),
  'utf8',
);
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
  'utf8',
);
const mediaWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url),
  'utf8',
);
const mediaRadar = readFileSync(
  new URL('../../native/src/renderer_panels/media_radar_section.inc', import.meta.url),
  'utf8',
);
const mediaPanel = [mediaBase, mediaHost, mediaWindow, mediaRadar].join('\n');
const mediaWrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const tverStatic = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url),
  'utf8',
);
const tverEpisode = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url),
  'utf8',
);

test('TVer episode playback is event-driven instead of a four-second DOM loop', () => {
  assert.match(tverEpisode, /new MutationObserver\(scheduleEnsure\)/);
  assert.match(tverEpisode, /addEventListener\('timeupdate'/);
  assert.match(tverEpisode, /addEventListener\('ended'/);
  assert.match(tverEpisode, /const scheduleEnsure = \(delay = 250\) =>/);
  assert.doesNotMatch(tverEpisode, /setInterval\(ensure, 4000\)/);
});

test('YouTube health and recovery use one adaptive native watchdog', () => {
  assert.match(mediaPanel, /kNativeMediaYoutubeWatchdogScript\[\]/);
  assert.match(mediaPanel, /video && video\.error/);
  assert.match(mediaPanel, /player\.classList\.contains\('ytp-error'\)/);
  assert.match(
    mediaPanel,
    /setPlaybackQualityRange\('large', 'large'\)[\s\S]*setPlaybackQuality\('large'\)/,
  );
  assert.match(mediaPanel, /kNativeMediaYoutubeWatchdogHealthyMs = 10U \* 1000U/);
  assert.match(mediaPanel, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(
    mediaPanel,
    /timerId == kNativeMediaYoutubeWatchdogTimer[\s\S]*kNativeMediaYoutubeWatchdogHealthyMs[\s\S]*ProbeYoutubeWatchdog\(\)/,
  );
  assert.match(
    mediaPanel,
    /ClickNormalizedPoint\(x, y\)[\s\S]*kNativeMediaYoutubeWatchdogRecoveryMs/,
  );
  assert.doesNotMatch(mediaPanel, /kNativeMediaPlaybackHealthTimer|ProbeYoutubeHealth/);
  assert.doesNotMatch(mediaWrapper, /kNativeMediaPlaybackHealthTimer/);
  assert.doesNotMatch(composition, /kNativeMediaYoutubeWatchdogOverrideScript/);
});

test('playlist startup uses one C++ fallback path after about ten seconds', () => {
  assert.match(mediaPanel, /kNativeMediaPlayAllRetryMs = 500U/);
  assert.match(mediaPanel, /kNativeMediaPlayAllRetryLimit = 20/);
  assert.match(
    mediaPanel,
    /playAllProbeAttempts_ >= kNativeMediaPlayAllRetryLimit[\s\S]*ClickNormalizedPoint\(kNativeMediaFallbackPlayAllXTenThousandths,[\s\S]*kNativeMediaFallbackPlayAllYTenThousandths\)/,
  );
  assert.doesNotMatch(mediaWrapper, /kNativeMediaPlayAllTimer[\s\S]*1000U/);
  assert.doesNotMatch(composition, /__homePanelPlayAllProbeState/);
});

test('YouTube quality remains 480p', () => {
  assert.match(mediaPanel, /setPlaybackQualityRange\('large', 'large'\)/);
  assert.doesNotMatch(mediaPanel, /setPlaybackQualityRange\('medium'/);
  assert.doesNotMatch(mediaPanel, /setPlaybackQualityRange\('small'/);
  assert.doesNotMatch(composition, /setPlaybackQualityRange\(/);
});

test('media responsibilities are split without changing the composition unit', () => {
  assert.match(mediaBase, /#include "media_host\.inc"/);
  assert.match(mediaBase, /#include "media_host_window\.inc"/);
  assert.match(mediaBase, /#include "media_radar_section\.inc"/);
  assert.match(mediaHost, /class NativeMediaPanelHost final/);
  assert.match(mediaWindow, /LRESULT CALLBACK NativeMediaPanelWndProc/);
  assert.match(mediaRadar, /void Renderer::DrawMusicSection/);
  assert.doesNotMatch(mediaBase, /class NativeMediaPanelHost final/);
  assert.doesNotMatch(mediaBase, /void Renderer::DrawMusicSection/);
});
