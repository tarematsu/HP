import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const mediaPanel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url),
  'utf8',
);
const mediaWrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const tverStatic = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url),
  'utf8',
);

test('TVer skips the expensive controls scan during stable low-quality playback', () => {
  assert.match(tverStatic, /state\.video !== video/);
  assert.match(tverStatic, /state\.lowQualitySet = false/);
  assert.match(
    tverStatic,
    /const stablePlayback = video && !video\.paused && !video\.ended &&[\s\S]*state\.lowQualitySet/,
  );
  assert.match(tverStatic, /if \(stablePlayback\) return/);
  assert.match(
    tverStatic,
    /if \(stablePlayback\) return;[\s\S]*const controls = Array\.from\(document\.querySelectorAll/,
  );
});

test('YouTube health and interaction watchdogs remain separate and active', () => {
  assert.match(mediaPanel, /kNativeMediaYoutubeHealthScript\[\]/);
  assert.match(mediaPanel, /video && video\.error/);
  assert.match(mediaPanel, /player && player\.classList\.contains\('ytp-error'\)/);
  assert.match(
    mediaPanel,
    /setPlaybackQualityRange\('large', 'large'\)[\s\S]*setPlaybackQuality\('large'\)/,
  );
  assert.match(
    mediaPanel,
    /SetTimer\(hostWindow_, kNativeMediaPlaybackHealthTimer,[\s\S]*kNativeMediaPlaybackHealthMs/,
  );
  assert.match(mediaPanel, /ProbeYoutubeHealth\(\)/);
  assert.match(mediaPanel, /kNativeMediaYoutubeWatchdogScript\[\]/);
  assert.match(mediaPanel, /\.ytp-ad-skip-button/);
  assert.doesNotMatch(mediaWrapper, /kNativeMediaPlaybackHealthTimer[\s\S]*static_cast<UINT_PTR>\(1\)/);
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
