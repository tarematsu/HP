import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const mediaWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url), 'utf8');
const mediaRadar = readFileSync(
  new URL('../../native/src/renderer_panels/media_radar_section.inc', import.meta.url), 'utf8');
const mediaWrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const youtubeClean = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url), 'utf8');
const youtubeRecovery = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url), 'utf8');
const youtubeAgent = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_event_agent.inc', import.meta.url), 'utf8');
const tverEpisode = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url), 'utf8');
const tverWatchdog = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url), 'utf8');
const nativeWindows = readFileSync(
  new URL('../../native/src/renderer_panels/windows.inc', import.meta.url), 'utf8');
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url), 'utf8');
const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url), 'utf8');
const webviewEnvironment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url), 'utf8');

test('native dashboard keeps one active media controller on the shared WebView2 environment', () => {
  assert.match(composition, /#include "renderer_panels\/media_section\.inc"/);
  assert.match(mediaBase, /HomePanelNativeMvPanel/);
  assert.match(mediaRadar, /EnsureNativeMvPanel\(nativeRadarWindow_, dataDir_, mediaBounds\)/);
  assert.match(mediaHost, /webview2-youtube-mv/);
  assert.match(mediaHost, /CreateCoreWebView2ControllerWithOptions/);
  assert.match(mediaHost, /CloseController\(\)/);
  assert.doesNotMatch(mediaHost, /environment_->CreateCoreWebView2Controller\(/);
});

test('media source composition separates host, HWND plumbing, and radar drawing', () => {
  assert.match(mediaBase, /#include "media_host\.inc"/);
  assert.match(mediaBase, /#include "media_host_window\.inc"/);
  assert.match(mediaBase, /#include "media_radar_section\.inc"/);
  assert.match(mediaHost, /class NativeMediaPanelHost final/);
  assert.match(mediaWindow, /LRESULT CALLBACK NativeMediaPanelWndProc/);
  assert.match(mediaRadar, /void Renderer::DrawMusicSection/);
});

test('YouTube and TVer reuse one profile and navigate the same controller', () => {
  assert.match(mediaBase, /kNativeMediaProfile\[\] = L"media-youtube"/);
  assert.match(mediaHost, /enum class Phase \{ YouTube, Tver \}/);
  assert.match(mediaHost, /put_ProfileName\(CurrentProfileName\(\)\)/);
  assert.match(mediaHost, /put_IsInPrivateModeEnabled\(FALSE\)/);
  assert.match(mediaBase, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaHost, /Phase::YouTube \? SwitchToTver\(\) : SwitchToYouTube\(\)/);
  assert.doesNotMatch(
    mediaHost,
    /void SwitchToYouTube\(\) noexcept[\s\S]*CloseController\(\)[\s\S]*void SwitchToTver/,
  );
});

test('phase overlay is event mounted without a one-second clock loop', () => {
  assert.match(mediaBase, /FormatNativeMediaLocalHourMinute/);
  assert.match(mediaHost, /__homePanelMediaPhaseTime/);
  assert.match(mediaHost, /cursor:none !important/);
  assert.match(mediaWindow, /windowClass\.hCursor = nullptr/);
  assert.doesNotMatch(mediaBase + mediaHost, /__homePanelMediaPhaseClockTimer/);
  assert.doesNotMatch(mediaBase + mediaHost, /setInterval\(mount, 1000\)/);
});

test('YouTube preserves playlist playback, 480p, captions off, skip and fullscreen with low steady load', () => {
  assert.match(mediaBase, /youtube\.com\/playlist\?list=PLMWqSdpIVl30/);
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogHealthyMs = 30U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(youtubeRecovery, /const preferredQuality = 'large'/);
  assert.match(youtubeRecovery, /setPlaybackQualityRange\(preferredQuality, preferredQuality\)/);
  assert.match(youtubeRecovery, /setOption\('captions', 'track', \{\}\)/);
  assert.match(youtubeRecovery, /\.ytp-ad-skip-button-modern/);
  assert.match(youtubeRecovery, /\.ytp-fullscreen-button/);
  assert.match(youtubeAgent, /homepanel:youtube-wake/);
  assert.match(youtubeAgent, /attributeFilter: \['class'\]/);
  assert.doesNotMatch(youtubeAgent, /document\.documentElement.*observe/);
});

test('YouTube clean player renders content video while preserving Skip Ad', () => {
  assert.match(youtubeClean, /kNativeMediaYoutubeCleanPlayerScript/);
  assert.match(
    youtubeClean,
    /#movie_player:not\(\.ad-showing\):not\(\.ad-interrupting\) > :not\(\.html5-video-container\)/,
  );
  assert.match(youtubeClean, /#movie_player \.html5-video-container > :not\(video\)/);
  assert.match(youtubeClean, /#movie_player \.ytp-ad-skip-button-modern/);
  assert.match(youtubeClean, /#movie_player \.ytp-share-button/);
  assert.match(youtubeClean, /opacity: 1 !important/);
});

test('TVer episode playback is 1.75x, cloud-queue based and player-local', () => {
  assert.match(tverEpisode, /const playbackRate = 1\.75/);
  assert.match(tverEpisode, /const targetVolume = 1\.0/);
  assert.match(tverEpisode, /episodeQueueKey = '__homePanelTverEpisodeQueue'/);
  assert.doesNotMatch(tverEpisode, /__homePanelTverEpisodeQueue:/);
  assert.match(tverEpisode, /const bindPlayerObserver = video =>/);
  assert.match(tverEpisode, /playerObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.doesNotMatch(tverEpisode, /observe\(document\.(?:documentElement|body)/);
  assert.match(tverEpisode, /qualityProbeLimit = 4/);
  assert.match(tverEpisode, /qualityProbeIntervalMs = 5000/);
  assert.match(mediaBase, /kNativeMediaTverWatchdogMs = 30U \* 1000U/);
  assert.match(mediaHost, /BeginTverPlaybackMonitor\(\)/);
  assert.match(mediaHost, /ProbeTverWatchdog\(\)/);
});

test('TVer ads are isolated to Skip and fullscreen automation', () => {
  const adStart = tverWatchdog.indexOf('if (adActive) {');
  const restart = tverWatchdog.indexOf('if (state && state.restartRequested)');
  const branch = tverWatchdog.slice(adStart, restart);
  assert.match(branch, /skipButton/);
  assert.match(branch, /fullscreenButton/);
  assert.doesNotMatch(branch, /video\.play\(|video\.volume|playbackRate|surveyRoots/);
});

test('TVer completion reuses the existing controller without cache/profile churn', () => {
  assert.match(mediaHost, /std::wstring_view\(json\) == L"\\\"restart\\\""/);
  assert.match(
    mediaHost,
    /CompleteTverRestart\(\) noexcept[\s\S]*StopNavigationRetry\(\);[\s\S]*NavigateCurrentPhase\(\);/,
  );
  assert.doesNotMatch(mediaHost, /ClearBrowsingData|COREWEBVIEW2_BROWSING_DATA_KINDS/);
});

test('normal media resources remain enabled and power saving keeps media WebView alive', () => {
  assert.match(
    mediaHost,
    /SharedWebViewEnvironment::Instance\(\)\.Acquire\(\s*userDataFolder_, false, false,/,
  );
  assert.match(webviewEnvironment, /if \(!blockImages && !blockFonts\) return \{\};/);
  assert.match(mediaHost, /put_IsScriptEnabled\(TRUE\)/);
  assert.match(mediaHost, /put_AreDevToolsEnabled\(FALSE\)/);
  assert.doesNotMatch(lifecycle, /StopNativeMvPlayback/);
  assert.match(nativeWindows, /nativeDashboardVisible_ && nativeRadarWindow_/);
});

test('event bridge is the only immediate wake path for media state transitions', () => {
  assert.match(mediaWrapper, /add_WebMessageReceived/);
  assert.match(mediaWrapper, /homepanel:youtube-wake/);
  assert.match(mediaWrapper, /homepanel:tver-wake/);
  assert.match(mediaWrapper, /PostMessageW\(hostWindow, WM_TIMER/);
});
