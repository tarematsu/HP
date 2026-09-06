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
const trustedInput = readFileSync(
  new URL('../../native/src/renderer_panels/media_trusted_input.inc', import.meta.url),
  'utf8',
);
const tverAdGuard = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url),
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
    mediaWrapper,
    /timerId\) == kNativeMediaPhaseTimer[\s\S]*NativeMediaPhaseIntervalMs\(phase_ == Phase::Tver\)/,
  );
  assert.match(
    mediaWrapper,
    /SetSpotifyMediaPhase\(phase_ == Phase::Tver\)/,
  );
});

test('phase overlay and TVer scripts are rewritten through the thin wrapper', () => {
  assert.match(composition, /CaptureNativeMediaPhaseOverlay/);
  assert.match(composition, /gNativeMediaPhaseOverlayText/);
  assert.match(composition, /__homePanelMediaPhaseTime/);
  assert.match(composition, /RewriteNativeMediaExecuteScript/);
  assert.match(mediaWrapper, /#undef ExecuteScript/);
  assert.match(
    mediaWrapper,
    /#define ExecuteScript\(script, callback\)[\s\S]*RewriteNativeMediaExecuteScriptWithTverAdGuard/,
  );
  assert.match(tverAdGuard, /RewriteNativeMediaExecuteScript\(script\)/);
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

test('TVer queues every public series item and keeps completion latching', () => {
  assert.match(composition, /kNativeMediaTverLoopOverrideScript/);
  assert.match(composition, /deathGameSeriesPath = '\/series\/srkzm5wbvp'/);
  assert.match(composition, /seriesPathKey = '__homePanelTverSeriesPath'/);
  assert.match(composition, /episodeQueueKey = seriesPath/);
  assert.match(composition, /__homePanelTverEpisodeQueue:/);
  assert.match(composition, /const advanceEpisodeOrSeries = \(\) =>/);
  assert.match(composition, /const previewMode = false/);
  assert.match(composition, /endCandidateAt: 0/);
  assert.match(composition, /addEventListener\('ended'/);
  assert.match(composition, /state\.endCandidateAt = Date\.now\(\)/);
  assert.match(composition, /video\.currentTime < 3[\s\S]*state\.endCandidateAt = 0/);
  assert.doesNotMatch(composition, /isMainEpisodeLink/);
  assert.match(composition, /const findSeriesEpisodeContainer = \(\) =>/);
  assert.match(composition, /if \(!episodeHeading\) return null/);
  assert.match(composition, /あなたにおすすめ\|おすすめ\|関連番組\|関連動画\|ランキング/);
  assert.match(composition, /if \(!container\) return/);
  assert.match(composition, /container\.querySelectorAll\('a\[href\*=\"\/episodes\/\"\]'\)/);
  assert.doesNotMatch(composition, /if \(!recommendationHeading\) return true/);
  assert.match(composition, /completedItem = state\.maxDuration >= 5/);
  assert.match(composition, /state\.maxTime >= Math\.max\(3, state\.maxDuration - 10\)/);
  assert.match(composition, /stableEndDelayMs = state\.maxDuration < 600 \? 8000 : 2500/);
  assert.match(composition, /stableEnd && completedItem/);
  assert.match(
    composition,
    /__homePanelSakuraMeetsLoopTimer[\s\S]*return kNativeMediaTverLoopOverrideScript/,
  );
  assert.match(composition, /window\.setInterval\(ensure, 4000\)/);
  assert.match(composition, /gNativeMediaTverSteadyIntervalMs = 4000U/);
});

test('TVer survey modal is dismissed by its close button', () => {
  assert.match(composition, /const dismissSurvey = \(\) =>/);
  assert.match(composition, /label !== '閉じる' && label !== 'close'/);
  assert.match(composition, /\/アンケート\/\.test\(text\)/);
  assert.match(composition, /\/回答する\/\.test\(text\)/);
  assert.match(composition, /if \(location\.hostname === 'tver\.jp'\) dismissSurvey\(\)/);
  assert.match(composition, /const surveyClose = controls\.find/);
  assert.match(composition, /if \(surveyClose\) return point\(surveyClose\)/);
});

test('TVer ads run at native speed without repeated playback or fullscreen interference', () => {
  assert.match(tverAdGuard, /isTverAdvertisementActive/);
  assert.match(tverAdGuard, /aria-label\*=\"広告\"/);
  assert.match(tverAdGuard, /duration >= 5 && duration <= 65/);
  assert.match(tverAdGuard, /const adVideoChanged = state\.adVideo !== video/);
  assert.match(tverAdGuard, /if \(!state\.adActive \|\| adVideoChanged\)/);
  assert.match(tverAdGuard, /state\.adActive = true/);
  assert.match(tverAdGuard, /window\.__homePanelTverAdActive = true/);
  assert.match(tverAdGuard, /video\.defaultPlaybackRate = 1\.0/);
  assert.match(tverAdGuard, /video\.playbackRate !== 1\.0/);
  assert.doesNotMatch(tverAdGuard, /document\.exitFullscreen/);
  assert.match(tverAdGuard, /state\.adActive = false/);
  assert.match(tverAdGuard, /state\.maxDuration = 0/);
  assert.match(tverAdGuard, /state\.maxTime = 0/);
  assert.match(tverAdGuard, /state\.playbackSettingsApplied = false/);
  assert.match(tverAdGuard, /state\.fullscreenDirty = true/);
  assert.match(tverAdGuard, /state && state\.adActive/);
  assert.match(tverAdGuard, /return null/);
  assert.match(tverAdGuard, /NativeMediaTverForceFullscreenAdSafeScript/);
  assert.match(
    trustedInput,
    /ExecuteScript\(\s*NativeMediaTverForceFullscreenAdSafeScript\(\)/,
  );
});

test('TVer main-content speed and fullscreen are reapplied only when state becomes dirty', () => {
  assert.match(tverAdGuard, /playbackSettingsApplied/);
  assert.match(tverAdGuard, /if \(!state\.playbackSettingsApplied\)/);
  assert.match(tverAdGuard, /state\.playbackSettingsApplied = true/);
  assert.match(tverAdGuard, /addEventListener\('ratechange'/);
  assert.match(tverAdGuard, /fullscreenDirty/);
  assert.match(tverAdGuard, /addEventListener\('fullscreenchange'/);
  assert.match(tverAdGuard, /state && state\.fullscreenDirty === false/);
  assert.match(tverAdGuard, /if \(state\) state\.fullscreenDirty = false/);
  assert.match(tverAdGuard, /ReplaceNativeMediaSnippet/);
});

test('hidden YouTube and TVer use trusted WebView2 input without moving the OS cursor', () => {
  assert.match(mediaWrapper, /#include \"media_trusted_input\.inc\"/);
  assert.match(mediaWrapper, /ArmNativeMediaTrustedWakeTimer/);
  assert.match(mediaWrapper, /NativeMediaDispatchTrustedInput/);
  assert.match(mediaWrapper, /#include \"media_section_base\.inc\"/);
  assert.match(trustedInput, /NativeMediaDecodeAbsolutePoint/);
  assert.match(trustedInput, /CallDevToolsProtocolMethod/);
  assert.match(trustedInput, /Input\.dispatchMouseEvent/);
  assert.match(trustedInput, /mouseMoved/);
  assert.match(trustedInput, /mousePressed/);
  assert.match(trustedInput, /mouseReleased/);
  assert.doesNotMatch(trustedInput, /::SendInput\(/);
  assert.match(
    mediaWrapper,
    /#define SendInput\(count, inputs, inputSize\)[\s\S]*NativeMediaDispatchTrustedInput[\s\S]*phase_ == Phase::Tver[\s\S]*webview_\.Get\(\)[\s\S]*hostWindow_/,
  );
});

test('TVer alternation keeps low quality and 1.75x while effective restart reuses the controller', () => {
  assert.match(composition, /const playbackRate = 1\.75/);
  assert.match(composition, /qualityName\(element\) === '低'/);
  assert.match(
    composition,
    /#define ClearBrowsingData\(dataKinds, handler\)[\s\S]*AddRef\(\) > 0[\s\S]*profile2->Release\(\)[\s\S]*CompleteTverRestart\(\)/,
  );
  assert.match(
    mediaPanel,
    /CompleteTverRestart\(\) noexcept[\s\S]*StopNavigationRetry\(\);[\s\S]*NavigateCurrentPhase\(\);/,
  );
  assert.doesNotMatch(
    mediaPanel,
    /CompleteTverRestart\(\) noexcept[\s\S]*CloseController\(\)[\s\S]*void RestartTverAfterPlayback/,
  );
  assert.doesNotMatch(
    mediaPanel,
    /CompleteTverRestart\(\) noexcept[\s\S]*CreateControllerForCurrentPhase\(\)[\s\S]*void RestartTverAfterPlayback/,
  );
});
