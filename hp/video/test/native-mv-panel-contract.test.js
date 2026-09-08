import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mediaPanel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url),
  'utf8',
);
const youtubePolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
  'utf8',
);
const tverStatic = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url),
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
  assert.match(mediaPanel, /void Renderer::DrawMusicSection/);
  assert.match(mediaPanel, /EnsureNativeMvPanel\(nativeRadarWindow_, dataDir_, mediaBounds\)/);
  assert.match(mediaPanel, /webview2-youtube-mv/);
  assert.match(mediaPanel, /ICoreWebView2Environment10/);
  assert.match(mediaPanel, /CreateCoreWebView2ControllerWithOptions/);
  assert.match(mediaPanel, /CloseController\(\)/);
  assert.doesNotMatch(mediaPanel, /environment_->CreateCoreWebView2Controller\(/);
});

test('YouTube and TVer reuse the existing YouTube login profile and one controller', () => {
  assert.match(mediaPanel, /kNativeMediaProfile\[\] = L"media-youtube"/);
  assert.doesNotMatch(mediaPanel, /kNativeMediaTverProfile/);
  assert.match(
    mediaPanel,
    /CurrentProfileName\(\) const noexcept \{[\s\S]*return kNativeMediaProfile;/,
  );
  assert.match(mediaPanel, /CreateCoreWebView2ControllerOptions/);
  assert.match(mediaPanel, /put_ProfileName\(CurrentProfileName\(\)\)/);
  assert.match(mediaPanel, /put_IsInPrivateModeEnabled\(FALSE\)/);
  assert.match(
    mediaPanel,
    /SharedWebViewEnvironment::Instance\(\)\.Acquire\(\s*userDataFolder_, false, false,/,
  );
});

test('media cycle alternates YouTube and TVer every hour by navigating the same controller', () => {
  assert.match(mediaPanel, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaPanel, /enum class Phase \{ YouTube, Tver \}/);
  assert.match(
    mediaPanel,
    /timerId == kNativeMediaPhaseTimer[\s\S]*Phase::YouTube \? SwitchToTver\(\) : SwitchToYouTube\(\)/,
  );
  assert.match(
    mediaPanel,
    /void SwitchToYouTube\(\) noexcept[\s\S]*StopNavigationRetry\(\);[\s\S]*NavigateCurrentPhase\(\);[\s\S]*ArmPhaseTimer\(\);/,
  );
  assert.match(
    mediaPanel,
    /void SwitchToTver\(\) noexcept[\s\S]*StopNavigationRetry\(\);[\s\S]*NavigateCurrentPhase\(\);[\s\S]*ArmPhaseTimer\(\);/,
  );
  assert.doesNotMatch(
    mediaPanel,
    /void SwitchToYouTube\(\) noexcept[\s\S]*CloseController\(\)[\s\S]*void SwitchToTver/,
  );
  assert.doesNotMatch(
    mediaPanel,
    /void SwitchToTver\(\) noexcept[\s\S]*CloseController\(\)[\s\S]*void NavigateCurrentPhase/,
  );
  assert.match(mediaPanel, /uint64_t controllerGeneration_ = 0/);
  assert.match(mediaPanel, /bool controllerCreating_ = false/);
  assert.doesNotMatch(composition, /SakuraMeetsTverPlayer/);
  assert.doesNotMatch(composition, /SetNativeMvTimerWithMediaCycle/);
  assert.doesNotMatch(composition, /SetSpotifyAmazonPodcastMode/);
});

test('YouTube and TVer keep phase start/end times visible without a permanent one-second DOM timer', () => {
  assert.match(mediaPanel, /FormatNativeMediaLocalHourMinute/);
  assert.match(
    mediaPanel,
    /CapturePhaseTimes\(\)[\s\S]*kNativeMediaPhaseMs\) \* 10000ULL/,
  );
  assert.match(
    mediaPanel,
    /SwitchToYouTube\(\) noexcept[\s\S]*CapturePhaseTimes\(\)[\s\S]*NavigateCurrentPhase\(\)/,
  );
  assert.match(
    mediaPanel,
    /SwitchToTver\(\) noexcept[\s\S]*CapturePhaseTimes\(\)[\s\S]*NavigateCurrentPhase\(\)/,
  );
  assert.match(mediaPanel, /__homePanelMediaPhaseTime/);
  assert.match(mediaPanel, /phase_ == Phase::YouTube \? L"YouTube " : L"TVer "/);
  assert.match(mediaPanel, /top:8px;right:8px;z-index:2147483647/);
  assert.match(mediaPanel, /padding:0;border:0;border-radius:0;background:transparent/);
  assert.match(mediaPanel, /color:rgba\(176,176,176,\.58\)/);
  assert.match(mediaPanel, /font:600 12px\/1\.2/);
  assert.match(mediaPanel, /cursor:none !important/);
  assert.match(mediaPanel, /windowClass\.hCursor = nullptr/);
  assert.match(mediaPanel, /document\.querySelector\('#movie_player'\)/);
  assert.doesNotMatch(mediaPanel, /__homePanelMediaPhaseClockTimer/);
  assert.doesNotMatch(mediaPanel, /setInterval\(mount, 1000\)/);
  assert.match(
    mediaPanel,
    /add_NavigationCompleted[\s\S]*ShowPhaseOverlay\(\)/,
  );
});

test('YouTube keeps playlist autoplay, 480p, captions off, ad skip, and fullscreen recovery', () => {
  assert.match(
    mediaPanel,
    /https:\/\/www\.youtube\.com\/playlist\?list=PLMWqSdpIVl30/,
  );
  assert.match(mediaPanel, /button, a, tp-yt-paper-button, \[role="button"\]/);
  assert.match(mediaPanel, /すべて再生/);
  assert.match(mediaPanel, /setPlaybackQualityRange\('large', 'large'\)/);
  assert.match(mediaPanel, /setPlaybackQuality\('large'\)/);
  assert.match(mediaPanel, /\.ytp-caption-window-container/);
  assert.match(mediaPanel, /player\.querySelector\('\.ytp-subtitles-button'\)/);
  assert.match(mediaPanel, /getAttribute\('aria-pressed'\) === 'true'/);
  assert.match(mediaPanel, /captionsButton\.click\(\)/);
  assert.match(mediaPanel, /player\.setOption\('captions', 'track', \{\}\)/);
  assert.match(mediaPanel, /kNativeMediaPlaybackHealthMs = 10U \* 1000U/);
  assert.match(mediaPanel, /kNativeMediaYoutubeWatchdogMinMs = 2U \* 1000U/);
  assert.match(mediaPanel, /kNativeMediaYoutubeWatchdogMaxMs = 10U \* 1000U/);
  assert.match(mediaPanel, /NextNativeMediaYoutubeWatchdogMs\(\)/);
  assert.match(mediaPanel, /QueryPerformanceCounter\(&counter\)/);
  assert.match(
    mediaPanel,
    /timerId == kNativeMediaYoutubeWatchdogTimer[\s\S]*NextNativeMediaYoutubeWatchdogMs\(\)[\s\S]*ProbeYoutubeWatchdog\(\)/,
  );
  assert.match(
    mediaPanel,
    /SetTimer\(hostWindow_, kNativeMediaYoutubeWatchdogTimer,[\s\S]*NextNativeMediaYoutubeWatchdogMs\(\), nullptr\)/,
  );
  assert.doesNotMatch(mediaPanel, /kNativeMediaYoutubeWatchdogMs = 1000U/);
  assert.match(mediaPanel, /document\.fullscreenElement/);
  assert.match(mediaPanel, /classList\.contains\('ytp-fullscreen'\)/);
  assert.match(mediaPanel, /\.ytp-fullscreen-button/);
  assert.match(mediaPanel, /\.ytp-ad-skip-button/);
  assert.match(mediaPanel, /homepanel-youtube-clean-player/);
  assert.match(mediaPanel, /content-visibility: hidden/);
});

test('YouTube renders only video during content while keeping ad controls operable', () => {
  assert.match(mediaPanel, /kNativeMediaYoutubeCleanPlayerScript/);
  assert.match(mediaPanel, /AddScriptToExecuteOnDocumentCreated\([\s\S]*kNativeMediaYoutubeCleanPlayerScript/);
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
  assert.match(youtubePolicy, /#movie_player\.ad-showing \*,/);
  assert.match(youtubePolicy, /#movie_player\.ad-interrupting \* \{/);
  assert.match(youtubePolicy, /opacity: 0 !important/);
  assert.match(youtubePolicy, /opacity: 1 !important/);
  assert.doesNotMatch(
    youtubePolicy,
    /#movie_player > :not\(\.html5-video-container\)[\s\S]{0,900}pointer-events: none/,
  );
});

test('effective TVer script queues published items at 1.75x, enforces low quality, and uses four-second recovery', () => {
  assert.match(tverStatic, /sakuraSeriesPath = '\/series\/srx97ftk3w'/);
  assert.match(tverStatic, /querySelectorAll\('a\[href\*="\/episodes\/"\]'\)/);
  assert.match(tverStatic, /const findSeriesEpisodeContainer = \(\) =>/);
  assert.match(tverStatic, /const playbackRate = 1\.75/);
  assert.match(tverStatic, /video\.defaultPlaybackRate = playbackRate/);
  assert.match(tverStatic, /video\.playbackRate = playbackRate/);
  assert.match(tverStatic, /window\.setInterval\(ensure, 4000\)/);
  assert.match(tverStatic, /qualityChoices/);
  assert.match(tverStatic, /qualityLabels\.size >= 3/);
  assert.match(tverStatic, /qualityName\(element\) === '低'/);
  assert.match(tverStatic, /lowOption\.click\(\)/);
  assert.match(tverStatic, /currentQuality\.click\(\)/);
  assert.match(mediaPanel, /kNativeMediaTverWatchdogTimer = 0x4D560007/);
  assert.match(mediaPanel, /kNativeMediaTverWatchdogMs = 4U \* 1000U/);
  assert.match(tverStatic, /kNativeMediaTverWatchdogStaticScript/);
  assert.match(tverStatic, /document\.fullscreenElement/);
  assert.match(tverStatic, /全画面/);
  assert.match(mediaPanel, /BeginTverPlaybackMonitor\(\)/);
  assert.match(mediaPanel, /ProbeTverWatchdog\(\)/);
  assert.match(
    mediaPanel,
    /timerId == kNativeMediaTverWatchdogTimer[\s\S]*ProbeTverWatchdog\(\)/,
  );
});

test('effective TVer completion path is direct and keeps the controller/profile intact', () => {
  assert.match(tverStatic, /state && state\.restartRequested\) return 'restart'/);
  assert.match(mediaPanel, /std::wstring_view\(json\) == L"\\\"restart\\\""/);
  assert.match(
    mediaPanel,
    /RestartTverAfterPlayback\(\) noexcept[\s\S]*StopTverPlaybackMonitor\(\);[\s\S]*AdvanceNativeMediaTverSeries\(\);[\s\S]*CompleteTverRestart\(\);/,
  );
  assert.match(
    mediaPanel,
    /CompleteTverRestart\(\) noexcept[\s\S]*StopNavigationRetry\(\);[\s\S]*NavigateCurrentPhase\(\);/,
  );
  assert.doesNotMatch(mediaPanel, /ClearBrowsingData|COREWEBVIEW2_BROWSING_DATA_KINDS/);
  assert.doesNotMatch(composition, /#define get_Profile|#define ClearBrowsingData/);
  assert.doesNotMatch(
    mediaPanel,
    /CompleteTverRestart\(\) noexcept[\s\S]*CloseController\(\)[\s\S]*void RestartTverAfterPlayback/,
  );
  assert.doesNotMatch(
    mediaPanel,
    /CompleteTverRestart\(\) noexcept[\s\S]*CreateControllerForCurrentPhase\(\)[\s\S]*void RestartTverAfterPlayback/,
  );
  assert.doesNotMatch(
    mediaPanel,
    /CompleteTverRestart\(\) noexcept[\s\S]*ArmPhaseTimer\(\)/,
  );
});

test('normal YouTube and TVer resources remain enabled on the shared WebView environment', () => {
  assert.match(
    mediaPanel,
    /SharedWebViewEnvironment::Instance\(\)\.Acquire\(\s*userDataFolder_, false, false,/,
  );
  assert.match(webviewEnvironment, /if \(!blockImages && !blockFonts\) return \{\};/);
  assert.match(mediaPanel, /put_IsScriptEnabled\(TRUE\)/);
  assert.match(mediaPanel, /put_AreDefaultContextMenusEnabled\(FALSE\)/);
  assert.match(mediaPanel, /put_AreDevToolsEnabled\(FALSE\)/);
  assert.match(mediaPanel, /put_AreBrowserAcceleratorKeysEnabled\(FALSE\)/);
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
