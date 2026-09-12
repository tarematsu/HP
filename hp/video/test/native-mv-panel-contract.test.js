import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const mediaBase = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url), 'utf8');
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url), 'utf8');
const mediaWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url), 'utf8');
const radarSection = readFileSync(
  new URL('../../native/src/renderer_panels/radar_section.inc', import.meta.url), 'utf8');
const mediaWrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const trustedInput = readFileSync(
  new URL('../../native/src/renderer_panels/media_trusted_input.inc', import.meta.url), 'utf8');
const youtubeClean = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url), 'utf8');
const youtubeRecovery = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_youtube_control_recovery.inc', import.meta.url);
const youtubeAgent = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_event_agent.inc', import.meta.url), 'utf8');
const tverEpisode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const tverWatchdog = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);
const tverQueue = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');
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
  assert.match(nativeWindows, /EnsureNativeMvPanel\(nativeMediaWindow_, dataDir_, mediaBounds\)/);
  assert.match(mediaHost, /webview2-youtube-mv/);
  assert.match(mediaHost, /CreateCoreWebView2ControllerWithOptions/);
  assert.match(mediaHost, /CloseController\(\)/);
  assert.doesNotMatch(mediaHost, /environment_->CreateCoreWebView2Controller\(/);
});

test('media source composition stays separate from radar drawing', () => {
  assert.match(mediaBase, /#include "media_host\.inc"/);
  assert.match(mediaBase, /#include "media_host_window\.inc"/);
  assert.doesNotMatch(mediaBase, /radar_section\.inc/);
  assert.match(composition, /#include "renderer_panels\/radar_section\.inc"/);
  assert.match(mediaHost, /class NativeMediaPanelHost final/);
  assert.match(mediaWindow, /LRESULT CALLBACK NativeMediaPanelWndProc/);
  assert.match(radarSection, /void Renderer::DrawRadarSection/);
  assert.doesNotMatch(radarSection, /EnsureNativeMvPanel/);
});

test('media container never paints the rain radar behind WebView2', () => {
  const mediaPaint = nativeWindows.slice(nativeWindows.indexOf('void Renderer::PaintNativeMedia'));
  assert.match(mediaPaint, /BLACK_BRUSH/);
  assert.doesNotMatch(mediaPaint, /StretchRadarInto|radarFrameBitmap_|雨雲レーダー/);
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

test('phase clock is removed while cursor hiding remains', () => {
  assert.doesNotMatch(mediaBase + mediaHost + mediaWrapper, /__homePanelMediaPhaseTime/);
  assert.doesNotMatch(mediaBase + mediaHost, /FormatNativeMediaLocalHourMinute|CapturePhaseTimes/);
  assert.match(mediaWrapper, /kNativeMediaCursorSuppressionScript/);
  assert.match(mediaWrapper, /cursor:none !important/);
  assert.match(mediaWindow, /windowClass\.hCursor = nullptr/);
});

test('YouTube preserves playlist playback, one-shot 480p, captions off, skip and fullscreen', () => {
  assert.match(mediaBase, /homepanel-cloud\.tarematsu\.workers\.dev\/v1\/native\/youtube-start/);
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogHealthyMs = 30U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(youtubeRecovery, /const preferredQuality = 'large'/);
  assert.match(youtubeRecovery, /setPlaybackQualityRange\(preferredQuality, preferredQuality\)/);
  assert.doesNotMatch(youtubeRecovery, /getPlaybackQuality\(\)/);
  assert.match(youtubeRecovery, /setOption\('captions', 'track', \{\}\)/);
  assert.match(youtubeRecovery, /\.ytp-ad-skip-button-modern/);
  assert.match(youtubeRecovery, /\.ytp-fullscreen-button/);
  assert.match(youtubeRecovery, /fullscreenApplied: false/);
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

test('TVer episode playback is one-shot 1.75x, native-queue based and player-local', () => {
  assert.match(tverEpisode, /const playbackRate = 1\.75/);
  assert.match(tverEpisode, /const targetVolume = 1\.0/);
  assert.match(tverQueue, /struct NativeMediaTverNativeQueueState/);
  assert.match(tverQueue, /queueEpisodeIds/);
  assert.doesNotMatch(tverEpisode, /__homePanelTverEpisodeQueue|sessionStorage|location\.replace/);
  assert.match(tverEpisode, /const bindPlayerObserver = video =>/);
  assert.match(tverEpisode, /playerObserver\.observe\(root, \{ childList: true, subtree: true \}\)/);
  assert.match(tverEpisode, /homepanel:tver-media-init/);
  assert.match(tverEpisode, /homepanel:tver-ended/);
  assert.doesNotMatch(tverEpisode, /observe\(document\.(?:documentElement|body)/);
  assert.doesNotMatch(tverEpisode, /addEventListener\('ratechange'/);
  assert.doesNotMatch(tverEpisode, /qualityProbeIntervalMs|qualityProbeLimit|qualityProbeAttempts|qualityProbeAt/);
  assert.match(mediaBase, /kNativeMediaTverWatchdogMs = 30U \* 1000U/);
  assert.match(mediaHost, /BeginTverPlaybackMonitor\(\)/);
  assert.match(mediaHost, /ProbeTverWatchdog\(\)/);
});

test('TVer media initialization performs one pointer wake without burst polling', () => {
  assert.match(mediaWrapper, /message == L"homepanel:tver-media-init"/);
  assert.match(mediaWrapper, /NativeMediaTverMarkMediaReady\(source\)/);
  assert.match(mediaWrapper, /NativeMediaTrustedWake\(hostWindow, sender, nullptr\)/);
  assert.match(trustedInput, /NativeMediaDispatchTrustedMove\(webview, x, y\)/);
  assert.match(trustedInput, /return ::SetTimer\(hwnd, timerId, steadyIntervalMs, nullptr\)/);
  assert.doesNotMatch(
    trustedInput,
    /kNativeMediaTrustedWakeIntervalMs|kNativeMediaTrustedWakeAttempts|NativeMediaTrustedWakeTimerProc/,
  );
});

test('TVer ads are isolated to Skip and one-shot fullscreen automation', () => {
  const adStart = tverWatchdog.indexOf('if (adActive) {');
  const survey = tverWatchdog.indexOf('const surveyRoots = Array.from', adStart);
  const branch = tverWatchdog.slice(adStart, survey);
  assert.match(branch, /skipButton/);
  assert.match(branch, /fullscreenButton/);
  assert.match(branch, /fullscreenDirty === false/);
  assert.doesNotMatch(branch, /video\.play\(|video\.volume|playbackRate|surveyRoots/);
});

test('TVer completion reuses the existing controller with native next-episode navigation', () => {
  assert.match(mediaWrapper, /message == L"homepanel:tver-ended"/);
  assert.match(mediaWrapper, /NativeMediaTverAdvanceEpisode\(source\)/);
  assert.match(mediaWrapper, /sender->Navigate\(next\.c_str\(\)\)/);
  assert.match(mediaHost, /NativeMediaTverCurrentEpisodeUrl\(hostWindow_, alive_\)/);
  assert.doesNotMatch(mediaHost, /ClearBrowsingData|COREWEBVIEW2_BROWSING_DATA_KINDS/);
});

test('media WebView blocks image and font requests without touching playback resources', () => {
  assert.match(
    mediaHost,
    /SharedWebViewEnvironment::Instance\(\)\.Acquire\(\s*userDataFolder_, false, false,/,
  );
  assert.match(
    mediaHost,
    /AddWebResourceRequestedFilter\(\s*L"\*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE\)/,
  );
  assert.match(
    mediaHost,
    /AddWebResourceRequestedFilter\(\s*L"\*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT\)/,
  );
  assert.doesNotMatch(
    mediaHost,
    /AddWebResourceRequestedFilter\(\s*L"\*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA\)/,
  );
  assert.match(
    mediaHost,
    /CreateWebResourceResponse\(\s*nullptr, 204, L"No Content"/,
  );
  assert.match(mediaHost, /remove_WebResourceRequested\(webResourceRequestedToken_\)/);

  const fullResourceStart = webviewEnvironment.indexOf(
    'constexpr wchar_t kFullResourceWebView2Arguments[]',
  );
  const stationheadStart = webviewEnvironment.indexOf(
    'constexpr wchar_t kStationheadWebView2Arguments[]',
  );
  assert.ok(fullResourceStart >= 0 && stationheadStart > fullResourceStart);
  const fullResourceArguments = webviewEnvironment.slice(fullResourceStart, stationheadStart);
  assert.match(fullResourceArguments, /MediaRouter/);
  assert.match(fullResourceArguments, /Translate/);
  assert.match(fullResourceArguments, /OptimizationGuideModelDownloading/);
  assert.match(fullResourceArguments, /AutofillServerCommunication/);
  assert.doesNotMatch(fullResourceArguments, /BackForwardCache|HardwareSecureDecryption/);

  assert.match(mediaHost, /put_IsScriptEnabled\(TRUE\)/);
  assert.match(mediaHost, /put_AreDevToolsEnabled\(FALSE\)/);
  assert.doesNotMatch(lifecycle, /StopNativeMvPlayback/);
  assert.match(nativeWindows, /nativeDashboardVisible_ && nativeMediaWindow_/);
});

test('event bridge is the only immediate wake path for media state transitions', () => {
  assert.match(mediaWrapper, /add_WebMessageReceived/);
  assert.match(mediaWrapper, /homepanel:youtube-wake/);
  assert.match(mediaWrapper, /homepanel:tver-media-init/);
  assert.match(mediaWrapper, /homepanel:tver-ended/);
  assert.match(mediaWrapper, /homepanel:tver-wake/);
  assert.match(mediaWrapper, /PostMessageW\(hostWindow, WM_TIMER/);
});
