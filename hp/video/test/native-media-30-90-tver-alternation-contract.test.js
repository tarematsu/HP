import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const mediaPanel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('effective media cadence is YouTube 60 minutes then TVer 60 minutes', () => {
  assert.match(composition, /kNativeMediaYoutubePhaseOverrideMs = 60U \* 60U \* 1000U/);
  assert.match(composition, /kNativeMediaTverPhaseOverrideMs = 60U \* 60U \* 1000U/);
  assert.match(
    composition,
    /NativeMediaPhaseIntervalMs\(bool tver\)[\s\S]*kNativeMediaTverPhaseOverrideMs[\s\S]*kNativeMediaYoutubePhaseOverrideMs/,
  );
  assert.match(
    composition,
    /timerId\) == kNativeMediaPhaseTimer[\s\S]*NativeMediaPhaseIntervalMs\(phase_ == Phase::Tver\)/,
  );
  assert.match(
    composition,
    /SetSpotifyMediaPhase\(phase_ == Phase::Tver\)/,
  );
});

test('phase overlay is rewritten to the effective 60/60 minute boundary', () => {
  assert.match(composition, /CaptureNativeMediaPhaseOverlay\(phase_ == Phase::Tver\)/);
  assert.match(composition, /gNativeMediaPhaseOverlayText/);
  assert.match(composition, /__homePanelMediaPhaseTime/);
  assert.match(composition, /RewriteNativeMediaExecuteScript/);
  assert.match(
    composition,
    /#define ExecuteScript\(script, callback\)[\s\S]*RewriteNativeMediaExecuteScript/,
  );
});

test('TVer alternates Sakura Meets and Death Youth Game after completed items', () => {
  assert.match(composition, /https:\/\/tver\.jp\/series\/srx97ftk3w/);
  assert.match(composition, /https:\/\/tver\.jp\/series\/srkzm5wbvp/);
  assert.match(composition, /gNativeMediaTverUseDeathGame = false/);
  assert.match(composition, /ResolveNativeMediaNavigateUrl/);
  assert.match(
    composition,
    /gNativeMediaTverUseDeathGame \? kNativeMediaDeathGameSeriesUrl[\s\S]*kNativeMediaSakuraMeetsSeriesUrl/,
  );
  assert.match(
    composition,
    /AdvanceNativeMediaTverSeries\(\) noexcept[\s\S]*gNativeMediaTverUseDeathGame = !gNativeMediaTverUseDeathGame/,
  );
  assert.match(
    composition,
    /#define Navigate\(url\) Navigate\(ResolveNativeMediaNavigateUrl\(\(url\)\)\)/,
  );
  assert.match(
    composition,
    /#define get_Profile\(out\)[\s\S]*AdvanceNativeMediaTverSeries\(\)/,
  );
});

test('Death Youth Game selects its preview and reliably latches short-preview completion', () => {
  assert.match(composition, /kNativeMediaTverLoopOverrideScript/);
  assert.match(composition, /deathGameSeriesPath = '\/series\/srkzm5wbvp'/);
  assert.match(composition, /seriesPathKey = '__homePanelTverSeriesPath'/);
  assert.match(composition, /seriesPath === deathGameSeriesPath/);
  assert.match(composition, /予告\|\\bPR\\b\|ティザー\|teaser\|trailer/i);
  assert.match(composition, /previewMode = storedSeriesPath\(\) === deathGameSeriesPath/);
  assert.match(composition, /endCandidateAt: 0/);
  assert.match(composition, /addEventListener\('ended'/);
  assert.match(composition, /state\.endCandidateAt = Date\.now\(\)/);
  assert.match(composition, /video\.currentTime < 3[\s\S]*state\.endCandidateAt = 0/);
  assert.match(composition, /completedPreview = state\.previewMode/);
  assert.match(composition, /state\.maxDuration >= 10 && state\.maxTime >= 5/);
  assert.match(composition, /Date\.now\(\) - state\.endCandidateAt >= 2500/);
  assert.match(composition, /stableEnd && \(completedPreview \|\| completedEpisode\)/);
  assert.match(
    composition,
    /__homePanelSakuraMeetsLoopTimer[\s\S]*return kNativeMediaTverLoopOverrideScript/,
  );
});

test('TVer fullscreen uses trusted native input then requestFullscreen when the button is hidden', () => {
  assert.match(composition, /kNativeMediaTverWatchdogOverrideScript/);
  assert.match(
    composition,
    /fullscreenButton \? point\(fullscreenButton\) : \(video \? point\(video\) : null\)/,
  );
  assert.match(composition, /kNativeMediaTverForceFullscreenAfterClickScript/);
  assert.match(composition, /window\.setTimeout\(async \(\) =>/);
  assert.match(composition, /target\.requestFullscreen \|\| target\.webkitRequestFullscreen/);
  assert.match(composition, /NativeMediaSendInputWithTverFullscreen/);
  assert.match(composition, /const UINT sent = ::SendInput\(count, inputs, inputSize\)/);
  assert.match(
    composition,
    /webview->ExecuteScript\(kNativeMediaTverForceFullscreenAfterClickScript, nullptr\)/,
  );
  assert.match(
    composition,
    /#define SendInput\(count, inputs, inputSize\)[\s\S]*phase_ == Phase::Tver[\s\S]*webview_\.Get\(\)/,
  );
});

test('TVer alternation keeps low quality and 1.75x while effective restart skips browsing-data deletion', () => {
  assert.match(composition, /const playbackRate = 1\.75/);
  assert.match(composition, /qualityName\(element\) === '低'/);
  assert.match(
    composition,
    /#define ClearBrowsingData\(dataKinds, handler\)[\s\S]*AddRef\(\) > 0[\s\S]*profile2->Release\(\)[\s\S]*CompleteTverRestart\(\)/,
  );
  const clearOverrideStart = composition.indexOf('#define ClearBrowsingData');
  const executeOverrideStart = composition.indexOf('#define ExecuteScript');
  assert.notEqual(clearOverrideStart, -1);
  assert.notEqual(executeOverrideStart, -1);
  const clearOverride = composition.slice(clearOverrideStart, executeOverrideStart);
  assert.doesNotMatch(clearOverride, /COOKIES|DISK_CACHE|CACHE_STORAGE/);
  assert.match(
    mediaPanel,
    /CompleteTverRestart\(\) noexcept[\s\S]*CloseController\(\)[\s\S]*CreateControllerForCurrentPhase\(\)/,
  );
});