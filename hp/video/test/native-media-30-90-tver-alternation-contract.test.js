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
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
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
const tverStatic = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url),
  'utf8',
);

test('media cadence is statically 60 minutes per YouTube/TVer phase', () => {
  assert.match(mediaPanel, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(
    mediaWrapper,
    /kNativeMediaPhaseTimer[\s\S]*SetSpotifyMediaPhase\(phase_ == Phase::Tver\)/,
  );
  assert.doesNotMatch(composition, /PhaseOverrideMs/);
  assert.doesNotMatch(mediaWrapper, /NativeMediaPhaseIntervalMs/);
});

test('media scripts remain fixed static literals while policy routing avoids C++ source rewriting', () => {
  assert.match(tverStatic, /kNativeMediaTverLoopStaticScript\[\]/);
  assert.match(tverStatic, /kNativeMediaTverWatchdogStaticScript\[\]/);
  assert.match(tverStatic, /kNativeMediaTverForceFullscreenAdSafeScript\[\]/);
  assert.match(mediaPanel, /kNativeMediaTverLoopScript =\s*kNativeMediaTverLoopStaticScript/);
  assert.match(mediaPanel, /kNativeMediaTverWatchdogScript =\s*kNativeMediaTverWatchdogStaticScript/);
  assert.match(mediaWrapper, /ResolveNativeMediaPolicyScript/);
  assert.doesNotMatch(mediaWrapper, /ResolveNativeMediaStaticScript/);
  assert.doesNotMatch(composition, /RewriteNativeMediaExecuteScript/);
  assert.doesNotMatch(tverStatic, /InsertNativeMediaSnippet|ReplaceNativeMediaSnippet|std::wstring rewritten|\.find\(L"|\.insert\(/);
  // JavaScript's ordinary String.replace is allowed inside a fixed literal; only
  // C++ source rewriting/generation is prohibited.
  assert.doesNotMatch(mediaPanel, /const openLatestEpisode =/);
});

test('TVer alternates Sakura Meets and Death Youth Game after a completed queue', () => {
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
  assert.match(composition, /#define Navigate\(url\) Navigate\(ResolveNativeMediaNavigateUrl\(\(url\)\)\)/);
  assert.match(
    mediaHost,
    /RestartTverAfterPlayback\(\) noexcept[\s\S]*AdvanceNativeMediaTverSeries\(\);[\s\S]*CompleteTverRestart\(\);/,
  );
});

test('TVer queues only the series episode section and latches item completion', () => {
  assert.match(tverStatic, /seriesPathKey = '__homePanelTverSeriesPath'/);
  assert.match(tverStatic, /episodeQueueKey = seriesPath/);
  assert.match(tverStatic, /__homePanelTverEpisodeQueue:/);
  assert.match(tverStatic, /const advanceEpisodeOrSeries = \(\) =>/);
  assert.match(tverStatic, /endCandidateAt: 0/);
  assert.match(tverStatic, /addEventListener\('ended'/);
  assert.match(tverStatic, /state\.endCandidateAt = Date\.now\(\)/);
  assert.match(tverStatic, /video\.currentTime < 3[\s\S]*state\.endCandidateAt = 0/);
  assert.match(tverStatic, /const findSeriesEpisodeContainer = \(\) =>/);
  assert.match(tverStatic, /if \(!episodeHeading\) return null/);
  assert.match(tverStatic, /あなたにおすすめ\|おすすめ\|関連番組\|関連動画\|ランキング/);
  assert.match(tverStatic, /if \(!container\) return/);
  assert.match(tverStatic, /container\.querySelectorAll\('a\[href\*=\"\/episodes\/\"\]'\)/);
  assert.match(tverStatic, /completedItem = state\.maxDuration >= 5/);
  assert.match(tverStatic, /state\.maxTime >= Math\.max\(3, state\.maxDuration - 10\)/);
  assert.match(tverStatic, /stableEndDelayMs = state\.maxDuration < 600 \? 8000 : 2500/);
  assert.match(tverStatic, /stableEnd && completedItem/);
  assert.doesNotMatch(tverStatic, /window\.setInterval\(ensure, 4000\)/);
  assert.match(tverStatic, /new MutationObserver\(scheduleEnsure\)/);
  assert.match(tverStatic, /observer\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.match(tverStatic, /window\.setTimeout\([\s\S]*ensure\(\);[\s\S]*250/);
  assert.match(tverStatic, /'play', 'pause', 'ended', 'ratechange', 'loadedmetadata', 'emptied'/);
  assert.doesNotMatch(tverStatic, /previewMode/);
});

test('TVer survey close is handled by one trusted watchdog path', () => {
  assert.match(tverStatic, /const surveyClose = controls\.find/);
  assert.match(tverStatic, /label !== '閉じる' && label !== 'close'/);
  assert.match(tverStatic, /\/アンケート\/\.test\(text\)/);
  assert.match(tverStatic, /\/回答する\/\.test\(text\)/);
  assert.match(tverStatic, /if \(surveyClose\) return point\(surveyClose\)/);
  assert.doesNotMatch(tverStatic, /const dismissSurvey =/);
});

test('TVer ads stay at native speed and suspend program/fullscreen controls', () => {
  assert.match(tverStatic, /isTverAdvertisementActive/);
  assert.match(tverStatic, /aria-label\*=\"広告\"/);
  assert.match(tverStatic, /duration >= 5 && duration <= 65/);
  assert.match(tverStatic, /const mediaIdentity = video =>/);
  assert.match(tverStatic, /const adMediaChanged = state\.adVideo !== video \|\| state\.adIdentity !== identity/);
  assert.match(tverStatic, /state\.adActive = true/);
  assert.match(tverStatic, /state\.adIdentity = identity/);
  assert.match(tverStatic, /state\.adIdentity && identity && state\.adIdentity !== identity/);
  assert.match(tverStatic, /window\.__homePanelTverAdActive = true/);
  assert.match(tverStatic, /video\.defaultPlaybackRate = 1\.0/);
  assert.match(tverStatic, /video\.playbackRate !== 1\.0/);
  assert.match(tverStatic, /document\.exitFullscreen/);
  assert.match(tverStatic, /state\.adActive = false/);
  assert.match(tverStatic, /state\.adIdentity = ''/);
  assert.match(tverStatic, /state\.maxDuration = 0/);
  assert.match(tverStatic, /state\.maxTime = 0/);
  assert.match(tverStatic, /state\.playbackSettingsApplied = false/);
  assert.match(tverStatic, /state\.fullscreenDirty = true/);
  assert.match(
    tverStatic,
    /\(state && state\.adActive\) \|\| window\.__homePanelTverAdActive[\s\S]*return null/,
  );
  assert.match(trustedInput, /ExecuteScript\(\s*kNativeMediaTverForceFullscreenAdSafeScript/);
});

test('TVer program settings are reapplied only when media state becomes dirty', () => {
  assert.match(tverStatic, /playbackSettingsApplied/);
  assert.match(tverStatic, /if \(!state\.playbackSettingsApplied\)/);
  assert.match(tverStatic, /state\.playbackSettingsApplied = true/);
  assert.match(tverStatic, /addEventListener\('ratechange'/);
  assert.match(tverStatic, /fullscreenDirty/);
  assert.match(tverStatic, /addEventListener\('fullscreenchange'/);
  assert.match(tverStatic, /state && state\.fullscreenDirty === false/);
  assert.match(tverStatic, /if \(state\) state\.fullscreenDirty = false/);
  assert.match(tverStatic, /const stablePlayback = video && !video\.paused && !video\.ended/);
  assert.match(tverStatic, /if \(stablePlayback\) return/);
});

test('hidden YouTube and TVer use one WebView2 trusted-input path', () => {
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
  assert.doesNotMatch(trustedInput, /NativeMediaDirectSetTimer/);
  assert.doesNotMatch(composition, /NativeMediaSendInputWithTverFullscreen/);
  assert.doesNotMatch(composition, /WakeNativeMediaTverControls/);
});

test('YouTube health and recovery are owned by one adaptive static watchdog', () => {
  assert.match(mediaPanel, /kNativeMediaYoutubeWatchdogHealthyMs = 10U \* 1000U/);
  assert.match(mediaPanel, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(mediaPanel, /kNativeMediaYoutubeWatchdogScript\[\]/);
  assert.match(mediaWrapper, /#include \"media_youtube_control_recovery\.inc\"/);
  assert.match(mediaWrapper, /script == kNativeMediaYoutubeWatchdogScript/);
  assert.match(mediaWrapper, /return kNativeMediaYoutubeControlRecoveryScript/);
  assert.doesNotMatch(mediaPanel + mediaWrapper, /kNativeMediaYoutubeHealthScript|kNativeMediaYoutubeHealthPolicyScript/);
  assert.doesNotMatch(composition, /kNativeMediaYoutubeWatchdogOverrideScript/);
});

test('TVer restart is a direct same-controller navigation without profile/cache work', () => {
  assert.match(tverStatic, /const playbackRate = 1\.75/);
  assert.match(tverStatic, /qualityName\(element\) === '低'/);
  assert.match(
    mediaHost,
    /RestartTverAfterPlayback\(\) noexcept[\s\S]*StopTverPlaybackMonitor\(\);[\s\S]*AdvanceNativeMediaTverSeries\(\);[\s\S]*CompleteTverRestart\(\);/,
  );
  assert.match(
    mediaHost,
    /CompleteTverRestart\(\) noexcept[\s\S]*StopNavigationRetry\(\);[\s\S]*NavigateCurrentPhase\(\);/,
  );
  assert.doesNotMatch(mediaHost, /ClearBrowsingData|COREWEBVIEW2_BROWSING_DATA_KINDS/);
  assert.doesNotMatch(composition, /#define ClearBrowsingData|#define get_Profile/);
});
