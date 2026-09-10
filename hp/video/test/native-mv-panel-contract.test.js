import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
const youtubePolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
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
const nativeWindows = readFileSync(
  new URL('../../native/src/renderer_panels/windows.inc', import.meta.url),
  'utf8',
);
const lifecycle = readFileSync(
  new URL('../../native/src/renderer_lifecycle.cpp', import.meta.url),
  'utf8',
);
const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const webviewEnvironment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);

test('native dashboard keeps one active media controller on the shared WebView2 environment', () => {
  assert.match(composition, /#include "renderer_panels\/media_section\.inc"/);
  assert.match(mediaPanel, /HomePanelNativeMvPanel/);
  assert.match(mediaRadar, /void Renderer::DrawMusicSection/);
  assert.match(mediaRadar, /EnsureNativeMvPanel\(nativeRadarWindow_, dataDir_, mediaBounds\)/);
  assert.match(mediaHost, /webview2-youtube-mv/);
  assert.match(mediaHost, /ICoreWebView2Environment10/);
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
  assert.match(mediaWindow, /bool EnsureNativeMvPanel/);
  assert.match(mediaRadar, /void Renderer::DrawMusicSection/);
  assert.doesNotMatch(mediaBase, /class NativeMediaPanelHost final/);
  assert.doesNotMatch(mediaBase, /void Renderer::DrawMusicSection/);
});

test('YouTube and TVer reuse the existing YouTube login profile and one controller', () => {
  assert.match(mediaBase, /kNativeMediaProfile\[\] = L"media-youtube"/);
  assert.doesNotMatch(mediaPanel, /kNativeMediaTverProfile/);
  assert.match(
    mediaHost,
    /CurrentProfileName\(\) const noexcept \{[\s\S]*return kNativeMediaProfile;/,
  );
  assert.match(mediaHost, /CreateCoreWebView2ControllerOptions/);
  assert.match(mediaHost, /put_ProfileName\(CurrentProfileName\(\)\)/);
  assert.match(mediaHost, /put_IsInPrivateModeEnabled\(FALSE\)/);
  assert.match(
    mediaHost,
    /SharedWebViewEnvironment::Instance\(\)\.Acquire\(\s*userDataFolder_, false, false,/,
  );
});

test('media cycle alternates YouTube and TVer every hour by navigating the same controller', () => {
  assert.match(mediaBase, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaHost, /enum class Phase \{ YouTube, Tver \}/);
  assert.match(
    mediaHost,
    /timerId == kNativeMediaPhaseTimer[\s\S]*Phase::YouTube \? SwitchToTver\(\) : SwitchToYouTube\(\)/,
  );
  assert.match(
    mediaHost,
    /void SwitchToYouTube\(\) noexcept[\s\S]*StopNavigationRetry\(\);[\s\S]*NavigateCurrentPhase\(\);[\s\S]*ArmPhaseTimer\(\);/,
  );
  assert.match(
    mediaHost,
    /void SwitchToTver\(\) noexcept[\s\S]*StopNavigationRetry\(\);[\s\S]*NavigateCurrentPhase\(\);[\s\S]*ArmPhaseTimer\(\);/,
  );
  assert.doesNotMatch(
    mediaHost,
    /void SwitchToYouTube\(\) noexcept[\s\S]*CloseController\(\)[\s\S]*void SwitchToTver/,
  );
  assert.doesNotMatch(
    mediaHost,
    /void SwitchToTver\(\) noexcept[\s\S]*CloseController\(\)[\s\S]*void NavigateCurrentPhase/,
  );
  assert.match(mediaHost, /uint64_t controllerGeneration_ = 0/);
  assert.match(mediaHost, /bool controllerCreating_ = false/);
  assert.doesNotMatch(composition, /SakuraMeetsTverPlayer/);
  assert.doesNotMatch(composition, /SetNativeMvTimerWithMediaCycle/);
  assert.doesNotMatch(composition, /SetSpotifyAmazonPodcastMode/);
});

test('YouTube and TVer keep phase start/end times visible without a permanent one-second DOM timer', () => {
  assert.match(mediaBase, /FormatNativeMediaLocalHourMinute/);
  assert.match(
    mediaHost,
    /CapturePhaseTimes\(\)[\s\S]*kNativeMediaPhaseMs\) \* 10000ULL/,
  );
  assert.match(
    mediaHost,
    /SwitchToYouTube\(\) noexcept[\s\S]*CapturePhaseTimes\(\)[\s\S]*NavigateCurrentPhase\(\)/,
  );
  assert.match(
    mediaHost,
    /SwitchToTver\(\) noexcept[\s\S]*CapturePhaseTimes\(\)[\s\S]*NavigateCurrentPhase\(\)/,
  );
  assert.match(mediaHost, /__homePanelMediaPhaseTime/);
  assert.match(mediaHost, /phase_ == Phase::YouTube \? L"YouTube " : L"TVer "/);
  assert.match(mediaHost, /top:8px;right:8px;z-index:2147483647/);
  assert.match(mediaHost, /padding:0;border:0;border-radius:0;background:transparent/);
  assert.match(mediaHost, /color:rgba\(176,176,176,\.58\)/);
  assert.match(mediaHost, /font:600 12px\/1\.2/);
  assert.match(mediaHost, /cursor:none !important/);
  assert.match(mediaWindow, /windowClass\.hCursor = nullptr/);
  assert.match(mediaHost, /document\.querySelector\('#movie_player'\)/);
  assert.doesNotMatch(mediaPanel, /__homePanelMediaPhaseClockTimer/);
  assert.doesNotMatch(mediaPanel, /setInterval\(mount, 1000\)/);
  assert.match(
    mediaHost,
    /add_NavigationCompleted[\s\S]*ShowPhaseOverlay\(\)/,
  );
});

test('YouTube keeps playlist autoplay, 480p, captions off, ad skip, and adaptive recovery', () => {
  assert.match(
    mediaBase,
    /https:\/\/www\.youtube\.com\/playlist\?list=PLMWqSdpIVl30/,
  );
  assert.match(mediaBase, /button, a, tp-yt-paper-button, \[role="button"\]/);
  assert.match(mediaBase, /すべて再生/);
  assert.match(mediaBase, /setPlaybackQualityRange\('large', 'large'\)/);
  assert.match(mediaBase, /setPlaybackQuality\('large'\)/);
  assert.match(mediaBase, /\.ytp-caption-window-container/);
  assert.match(mediaBase, /player\.querySelector\('\.ytp-subtitles-button'\)/);
  assert.match(mediaBase, /getAttribute\('aria-pressed'\) === 'true'/);
  assert.match(mediaBase, /captionsButton\.click\(\)/);
  assert.match(mediaBase, /player\.setOption\('captions', 'track', \{\}\)/);
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogHealthyMs = 10U \* 1000U/);
  assert.match(mediaBase, /kNativeMediaYoutubeWatchdogRecoveryMs = 2U \* 1000U/);
  assert.match(
    mediaHost,
    /timerId == kNativeMediaYoutubeWatchdogTimer[\s\S]*kNativeMediaYoutubeWatchdogHealthyMs[\s\S]*ProbeYoutubeWatchdog\(\)/,
  );
  assert.match(
    mediaHost,
    /ClickNormalizedPoint\(x, y\)[\s\S]*kNativeMediaYoutubeWatchdogRecoveryMs/,
  );
  assert.doesNotMatch(mediaPanel, /kNativeMediaPlaybackHealthTimer|ProbeYoutubeHealth/);
  assert.match(mediaBase, /document\.fullscreenElement/);
  assert.match(mediaBase, /classList\.contains\('ytp-fullscreen'\)/);
  assert.match(mediaBase, /\.ytp-fullscreen-button/);
  assert.match(mediaBase, /\.ytp-ad-skip-button/);
  assert.match(mediaBase, /homepanel-youtube-clean-player/);
  assert.match(mediaBase, /content-visibility: hidden/);
});

test('YouTube renders only video during content while keeping only ad skip controls operable', () => {
  assert.match(youtubePolicy, /kNativeMediaYoutubeCleanPlayerScript/);
  assert.match(mediaHost, /AddScriptToExecuteOnDocumentCreated\([\s\S]*kNativeMediaYoutubeCleanPlayerScript/);
  assert.match(
    youtubePolicy,
    /#movie_player:not\(\.ad-showing\):not\(\.ad-interrupting\) > :not\(\.html5-video-container\)/,
  );
  assert.match(youtubePolicy, /#movie_player \.html5-video-container > :not\(video\)/);
  assert.match(youtubePolicy, /#movie_player \.ytp-title/);
  assert.match(youtubePolicy, /#movie_player \.ytp-chrome-bottom/);
  assert.match(youtubePolicy, /#movie_player \.ytp-fullscreen-quick-actions/);
  assert.match(youtubePolicy, /#movie_player \.ytp-overlay-top-left/);
  assert.match(youtubePolicy, /#movie_player \.ytp-overlay-bottom-right/);
  assert.match(youtubePolicy, /yt-player-overlay-video-details-renderer/);
  assert.match(youtubePolicy, /#movie_player \.ytp-pause-overlay/);
  assert.match(youtubePolicy, /#movie_player \.ytp-ce-element/);
  assert.match(youtubePolicy, /#movie_player \.ytp-watermark/);
  assert.match(youtubePolicy, /#movie_player \.ytp-caption-window-container/);
  assert.doesNotMatch(youtubePolicy, /#movie_player\.ad-showing \*,/);
  assert.doesNotMatch(youtubePolicy, /#movie_player\.ad-interrupting \* \{/);
  assert.match(youtubePolicy, /#movie_player \.ytp-ad-skip-button-modern/);
  assert.match(youtubePolicy, /#movie_player \.ytp-share-button/);
  assert.match(youtubePolicy, /ytd-unified-share-panel-renderer/);
  assert.match(youtubePolicy, /#movie_player \.ytp-tooltip/);
  assert.match(youtubePolicy, /opacity: 0 !important/);
  assert.match(youtubePolicy, /opacity: 1 !important/);
  assert.doesNotMatch(
    youtubePolicy,
    /#movie_player > :not\(\.html5-video-container\)[\s\S]{0,900}pointer-events: none/,
  );
});

test('effective TVer episode playback is event-driven at 1.75x with low-quality discovery', () => {
  assert.match(tverStatic, /sakuraSeriesPath = '\/series\/srx97ftk3w'/);
  assert.match(tverStatic, /querySelectorAll\('a\[href\*="\/episodes\/"\]'\)/);
  assert.match(tverStatic, /const findSeriesEpisodeContainer = \(\) =>/);
  assert.match(tverEpisode, /const playbackRate = 1\.75/);
  assert.match(tverEpisode, /video\.defaultPlaybackRate = playbackRate/);
  assert.match(tverEpisode, /video\.playbackRate = playbackRate/);
  assert.match(tverEpisode, /new MutationObserver\(scheduleEnsure\)/);
  assert.match(tverEpisode, /addEventListener\('timeupdate'/);
  assert.match(tverEpisode, /addEventListener\('ended'/);
  assert.doesNotMatch(tverEpisode, /setInterval\(ensure, 4000\)/);
  assert.match(tverEpisode, /qualityChoices/);
  assert.match(tverEpisode, /labels\.size >= 3/);
  assert.match(tverEpisode, /name === '低'/);
  assert.match(mediaBase, /kNativeMediaTverWatchdogTimer = 0x4D560007/);
  assert.match(mediaBase, /kNativeMediaTverWatchdogMs = 30U \* 1000U/);
  assert.match(tverStatic, /kNativeMediaTverWatchdogStaticScript/);
  assert.match(mediaHost, /BeginTverPlaybackMonitor\(\)/);
  assert.match(mediaHost, /ProbeTverWatchdog\(\)/);
  assert.match(
    mediaHost,
    /timerId == kNativeMediaTverWatchdogTimer[\s\S]*ProbeTverWatchdog\(\)/,
  );
});

test('effective TVer completion path is direct and keeps the controller/profile intact', () => {
  assert.match(tverStatic, /state && state\.restartRequested\) return 'restart'/);
  assert.match(mediaHost, /std::wstring_view\(json\) == L"\\\"restart\\\""/);
  assert.match(
    mediaHost,
    /RestartTverAfterPlayback\(\) noexcept[\s\S]*StopTverPlaybackMonitor\(\);[\s\S]*AdvanceNativeMediaTverSeries\(\);[\s\S]*CompleteTverRestart\(\);/,
  );
  assert.match(
    mediaHost,
    /CompleteTverRestart\(\) noexcept[\s\S]*StopNavigationRetry\(\);[\s\S]*NavigateCurrentPhase\(\);/,
  );
  assert.doesNotMatch(mediaHost, /ClearBrowsingData|COREWEBVIEW2_BROWSING_DATA_KINDS/);
  assert.doesNotMatch(composition, /#define get_Profile|#define ClearBrowsingData/);
  assert.doesNotMatch(
    mediaHost,
    /CompleteTverRestart\(\) noexcept[\s\S]*CloseController\(\)[\s\S]*void RestartTverAfterPlayback/,
  );
  assert.doesNotMatch(
    mediaHost,
    /CompleteTverRestart\(\) noexcept[\s\S]*CreateControllerForCurrentPhase\(\)[\s\S]*void RestartTverAfterPlayback/,
  );
  assert.doesNotMatch(
    mediaHost,
    /CompleteTverRestart\(\) noexcept[\s\S]*ArmPhaseTimer\(\)/,
  );
});

test('normal YouTube and TVer resources remain enabled on the shared WebView environment', () => {
  assert.match(
    mediaHost,
    /SharedWebViewEnvironment::Instance\(\)\.Acquire\(\s*userDataFolder_, false, false,/,
  );
  assert.match(webviewEnvironment, /if \(!blockImages && !blockFonts\) return \{\};/);
  assert.match(mediaHost, /put_IsScriptEnabled\(TRUE\)/);
  assert.match(mediaHost, /put_AreDefaultContextMenusEnabled\(FALSE\)/);
  assert.match(mediaHost, /put_AreDevToolsEnabled\(FALSE\)/);
  assert.match(mediaHost, /put_AreBrowserAcceleratorKeysEnabled\(FALSE\)/);
});

test('power saving hides dashboard work but keeps the media WebView alive', () => {
  assert.doesNotMatch(lifecycle, /StopNativeMvPlayback/);
  assert.match(
    lifecycle,
    /void Renderer::SetPowerSavingMode\(bool enabled\)[\s\S]*ApplyDashboardVisibility\(\)/,
  );
  assert.match(
    lifecycle,
    /if \(powerSavingMode_\) \{[\s\S]*nativeDashboardVisible_ = true;[\s\S]*EnsureNativeStaticWindows\(\);[\s\S]*nativeDashboardVisible_ = savedVisibility;/,
  );
  assert.match(
    nativeWindows,
    /if \(nativeDashboardVisible_ && nativeRadarWindow_ && IsWindow\(nativeRadarWindow_\)\)/,
  );
});
