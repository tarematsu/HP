import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mediaPanel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
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

test('YouTube and TVer use separate named login profiles while sharing the process family', () => {
  assert.match(mediaPanel, /kNativeMediaYoutubeProfile\[\] = L"media-youtube"/);
  assert.match(mediaPanel, /kNativeMediaTverProfile\[\] = L"media-tver"/);
  assert.match(
    mediaPanel,
    /CurrentProfileName\(\)[\s\S]*Phase::YouTube[\s\S]*kNativeMediaYoutubeProfile[\s\S]*kNativeMediaTverProfile/,
  );
  assert.match(mediaPanel, /CreateCoreWebView2ControllerOptions/);
  assert.match(mediaPanel, /put_ProfileName\(CurrentProfileName\(\)\)/);
  assert.match(mediaPanel, /put_IsInPrivateModeEnabled\(FALSE\)/);
  assert.match(
    mediaPanel,
    /SharedWebViewEnvironment::Instance\(\)\.Acquire\(\s*userDataFolder_, false, false,/,
  );
});

test('media cycle alternates YouTube and TVer every hour by recreating only the active profile controller', () => {
  assert.match(mediaPanel, /kNativeMediaPhaseMs = 60U \* 60U \* 1000U/);
  assert.match(mediaPanel, /enum class Phase \{ YouTube, Tver \}/);
  assert.match(
    mediaPanel,
    /timerId == kNativeMediaPhaseTimer[\s\S]*Phase::YouTube \? SwitchToTver\(\) : SwitchToYouTube\(\)/,
  );
  assert.match(
    mediaPanel,
    /void SwitchToYouTube\(\) noexcept[\s\S]*CloseController\(\)[\s\S]*CreateControllerForCurrentPhase\(\)[\s\S]*ArmPhaseTimer\(\)/,
  );
  assert.match(
    mediaPanel,
    /void SwitchToTver\(\) noexcept[\s\S]*CloseController\(\)[\s\S]*CreateControllerForCurrentPhase\(\)[\s\S]*ArmPhaseTimer\(\)/,
  );
  assert.match(mediaPanel, /uint64_t controllerGeneration_ = 0/);
  assert.match(mediaPanel, /bool controllerCreating_ = false/);
  assert.doesNotMatch(composition, /SakuraMeetsTverPlayer/);
  assert.doesNotMatch(composition, /SetNativeMvTimerWithMediaCycle/);
  assert.doesNotMatch(composition, /SetSpotifyAmazonPodcastMode/);
});

test('YouTube and TVer keep phase start/end times visible for the whole hour', () => {
  assert.match(mediaPanel, /FormatNativeMediaLocalHourMinute/);
  assert.match(
    mediaPanel,
    /CapturePhaseTimes\(\)[\s\S]*kNativeMediaPhaseMs\) \* 10000ULL/,
  );
  assert.match(
    mediaPanel,
    /SwitchToYouTube\(\) noexcept[\s\S]*CapturePhaseTimes\(\)[\s\S]*CreateControllerForCurrentPhase\(\)/,
  );
  assert.match(
    mediaPanel,
    /SwitchToTver\(\) noexcept[\s\S]*CapturePhaseTimes\(\)[\s\S]*CreateControllerForCurrentPhase\(\)/,
  );
  assert.match(mediaPanel, /__homePanelMediaPhaseTime/);
  assert.match(mediaPanel, /phase_ == Phase::YouTube \? L"YouTube " : L"TVer "/);
  assert.match(mediaPanel, /top:8px;right:8px;z-index:2147483647/);
  assert.match(mediaPanel, /font:600 12px\/1\.2/);
  assert.match(mediaPanel, /document\.querySelector\('#movie_player'\)/);
  assert.match(mediaPanel, /window\.__homePanelMediaPhaseClockTimer/);
  assert.match(mediaPanel, /window\.setInterval\(mount, 1000\)/);
  assert.match(
    mediaPanel,
    /add_NavigationCompleted[\s\S]*ShowPhaseOverlay\(\)/,
  );
});

test('YouTube keeps playlist autoplay, 480p, ad skip, and fullscreen recovery', () => {
  assert.match(
    mediaPanel,
    /https:\/\/www\.youtube\.com\/playlist\?list=PLMWqSdpIVl30/,
  );
  assert.match(mediaPanel, /button, a, tp-yt-paper-button, \[role="button"\]/);
  assert.match(mediaPanel, /すべて再生/);
  assert.match(mediaPanel, /setPlaybackQualityRange\('large', 'large'\)/);
  assert.match(mediaPanel, /setPlaybackQuality\('large'\)/);
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

test('YouTube transition title and fullscreen quick actions stay visually hidden', () => {
  assert.match(mediaPanel, /\.html5-video-player \.ytp-title/);
  assert.match(mediaPanel, /\.html5-video-player \.ytp-fullscreen-quick-actions/);
  assert.match(mediaPanel, /\.html5-video-player \.ytp-overlay-top-left/);
  assert.match(mediaPanel, /\.html5-video-player \.ytp-overlay-bottom-right/);
  assert.match(mediaPanel, /yt-player-overlay-video-details-renderer/);
  assert.match(mediaPanel, /\.html5-video-player \.ytp-fullscreen-grid/);
  assert.match(mediaPanel, /\.html5-video-player \.ytp-fullscreen-grid-stills-container/);
  assert.match(mediaPanel, /\.html5-video-player \.ytp-fullscreen-grid-expand-button/);
  assert.match(
    mediaPanel,
    /\.ytp-fullscreen-grid-expand-button \{[\s\S]*display: none !important;/,
  );
});

test('TVer phase opens Sakura Meets latest episode and loops it at 1.75x', () => {
  assert.match(mediaPanel, /https:\/\/tver\.jp\/series\/srx97ftk3w/);
  assert.match(mediaPanel, /querySelectorAll\('a\[href\*="\/episodes\/"\]'\)/);
  assert.match(mediaPanel, /最新話\|最新回/);
  assert.match(mediaPanel, /放課後トーク\|予告/);
  assert.match(mediaPanel, /const playbackRate = 1\.75/);
  assert.match(mediaPanel, /video\.defaultPlaybackRate = playbackRate/);
  assert.match(mediaPanel, /video\.playbackRate = playbackRate/);
  assert.match(mediaPanel, /video\.ended && state\.maxDuration >= 600 && state\.maxTime >= 300/);
  assert.match(mediaPanel, /location\.replace\(seriesUrl\)/);
  assert.match(mediaPanel, /window\.setInterval\(ensure, 2000\)/);
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
