import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const entry = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const mvPanel = readFileSync(
  new URL('../../native/src/renderer_panels/mv_section.inc', import.meta.url),
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

test('native dashboard compiles the MV panel and mounts it in the former radar window', () => {
  assert.match(entry, /#include "mv_section\.inc"/);
  assert.doesNotMatch(entry, /media_section_v2\.inc/);
  assert.match(composition, /#include "shared_webview_environment\.h"/);
  assert.match(mvPanel, /void Renderer::DrawMusicSection/);
  assert.match(mvPanel, /nativeRadarWindow_ && IsWindow\(nativeRadarWindow_\)/);
  assert.match(mvPanel, /GetClientRect\(nativeRadarWindow_, &mvBounds\)/);
  assert.match(mvPanel, /EnsureNativeMvPanel\(nativeRadarWindow_, dataDir_, mvBounds\)/);
  assert.doesNotMatch(mvPanel, /EnsureNativeMvPanel\(nativeMainWindow_,/);
});

test('MV WebView opens the requested YouTube playlist page directly', () => {
  assert.match(
    mvPanel,
    /https:\/\/www\.youtube\.com\/playlist\?list=PLMWqSdpIVl30/,
  );
  assert.match(mvPanel, /Navigate\(kNativeMvPanelPageUrl\)/);
  assert.doesNotMatch(mvPanel, /youtube\.com\/embed\/videoseries/);
  assert.doesNotMatch(mvPanel, /<iframe/);
  assert.doesNotMatch(mvPanel, /autoplay=1/);
  assert.doesNotMatch(mvPanel, /homepanel\.mv/);
  assert.doesNotMatch(mvPanel, /SetVirtualHostNameToFolderMapping\(/);
  assert.doesNotMatch(mvPanel, /PreparePlayerHtml\(/);
  assert.doesNotMatch(mvPanel, /assetFolder_/);
});

test('MV cycle closes WebView after 50:00-59:59 and reopens it after 60:00-79:59 internally', () => {
  assert.match(mvPanel, /kNativeMvRandomActionTimer/);
  assert.match(mvPanel, /kNativeMvPauseMinSeconds = 50U \* 60U/);
  assert.match(mvPanel, /kNativeMvPauseSpanSeconds = 10U \* 60U/);
  assert.match(mvPanel, /kNativeMvResumeMinSeconds = 60U \* 60U/);
  assert.match(mvPanel, /kNativeMvResumeSpanSeconds = 20U \* 60U/);
  assert.match(mvPanel, /random % spanSeconds/);
  assert.match(mvPanel, /return seconds \* 1000U/);
  assert.match(mvPanel, /ScheduleNextRandomAction\(UINT minSeconds, UINT spanSeconds\)/);
  assert.match(
    mvPanel,
    /if \(timerId == kNativeMvRandomActionTimer\) \{\s*if \(paused_\) \{\s*ResumeFromPause\(\);\s*\} else \{\s*EnterPause\(\);\s*\}/s,
  );
  assert.match(
    mvPanel,
    /void EnterPause\(\) noexcept \{[\s\S]*paused_ = true;[\s\S]*CloseWebView\(\);[\s\S]*ScheduleNextRandomAction\(kNativeMvResumeMinSeconds,\s*kNativeMvResumeSpanSeconds\)/,
  );
  assert.match(
    mvPanel,
    /void ResumeFromPause\(\) noexcept \{[\s\S]*paused_ = false;[\s\S]*ReopenWebView\(\);/,
  );
  assert.match(
    mvPanel,
    /void ReloadPlaylist\(\) noexcept \{[\s\S]*Navigate\(kNativeMvPanelPageUrl\)[\s\S]*ScheduleNextRandomAction\(kNativeMvPauseMinSeconds,\s*kNativeMvPauseSpanSeconds\)/,
  );
  assert.match(mvPanel, /controller_->Close\(\)/);
  assert.match(mvPanel, /webview_\.Reset\(\)/);
  assert.match(mvPanel, /CreateCoreWebView2Controller/);
  assert.doesNotMatch(mvPanel, /kNativeMvCenterXTenThousandths/);
  assert.doesNotMatch(mvPanel, /kNativeMvCenterYTenThousandths/);
  assert.doesNotMatch(
    mvPanel,
    /ClickNormalizedPoint\(kNativeMvCenterXTenThousandths/,
  );
  assert.doesNotMatch(mvPanel, /kNativeMvReloadTimer/);
  assert.doesNotMatch(mvPanel, /ScheduleNextPlaylistReload/);
});

test('MV pause surface uses a Sakurazaka46 artist image and native pause label', () => {
  assert.match(mvPanel, /sakurazaka46\.com\/files\/14\/Sakurazaka4615th/);
  assert.match(mvPanel, /WinHttpDownload\(/);
  assert.match(mvPanel, /DecodeImageBytesToBitmap\(/);
  assert.match(mvPanel, /StartPauseImageLoad\(\)/);
  assert.match(mvPanel, /DrawPauseScreen\(dc, client\)/);
  assert.match(mvPanel, /L"一時停止"/);
  assert.match(mvPanel, /StretchBlt\(/);
  assert.match(mvPanel, /kNativeMvPauseImageReadyMessage/);
});

test('MV playback enters YouTube fullscreen with DOM-located native input', () => {
  assert.match(mvPanel, /kNativeMvFullscreenRetryTimer/);
  assert.match(mvPanel, /kNativeMvFullscreenRetryMs = 500U/);
  assert.match(mvPanel, /kNativeMvFullscreenRetryLimit = 30/);
  assert.match(mvPanel, /\.ytp-fullscreen-button/);
  assert.match(mvPanel, /BeginFullscreenProbe\(\)/);
  assert.match(mvPanel, /ProbeFullscreenButton\(\)/);
  assert.match(mvPanel, /IsWatchPage\(\)/);
});

test('MV playback detects YouTube player errors and recovers through the playlist', () => {
  assert.match(mvPanel, /kNativeMvPlaybackHealthTimer/);
  assert.match(mvPanel, /kNativeMvPlaybackHealthMs = 10U \* 1000U/);
  assert.match(mvPanel, /kNativeMvNavigationRetryTimer/);
  assert.match(mvPanel, /kNativeMvNavigationRetryMs = 3U \* 1000U/);
  assert.match(mvPanel, /video && video\.error/);
  assert.match(mvPanel, /classList\.contains\('ytp-error'\)/);
  assert.match(mvPanel, /\.ytp-error-content-wrap/);
  assert.match(mvPanel, /ProbePlaybackHealth\(\)/);
  assert.match(mvPanel, /BeginPlaybackHealthMonitor\(\)/);
  assert.match(
    mvPanel,
    /std::wstring_view\(json\) == L"true"[\s\S]*ReloadPlaylist\(\)/,
  );
  assert.match(
    mvPanel,
    /!succeeded\)[\s\S]*StopPlaybackHealthMonitor\(\);[\s\S]*ScheduleNavigationRetry\(\)/,
  );
  assert.match(
    mvPanel,
    /timerId == kNativeMvNavigationRetryTimer[\s\S]*StopNavigationRetry\(\);[\s\S]*ReloadPlaylist\(\)/,
  );
});

test('MV playback pins YouTube quality to 480p and reapplies it', () => {
  assert.match(mvPanel, /document\.querySelector\('#movie_player'\)/);
  assert.match(mvPanel, /setPlaybackQualityRange\('large', 'large'\)/);
  assert.match(mvPanel, /setPlaybackQuality\('large'\)/);
  assert.match(
    mvPanel,
    /void BeginPlaybackHealthMonitor\(\) noexcept \{[\s\S]*SetTimer\(hostWindow_, kNativeMvPlaybackHealthTimer,[\s\S]*ProbePlaybackHealth\(\);[\s\S]*\}/,
  );
});

test('MV playback keeps YouTube transition chrome visually hidden', () => {
  assert.match(mvPanel, /homepanel-youtube-clean-player/);
  assert.match(mvPanel, /\.ytp-chrome-top/);
  assert.match(mvPanel, /\.ytp-gradient-top/);
  assert.match(mvPanel, /\.ytp-chrome-bottom/);
  assert.match(mvPanel, /\.ytp-gradient-bottom/);
  assert.match(mvPanel, /opacity:\s*0\s*!important/);
  assert.match(mvPanel, /transition:\s*none\s*!important/);
  assert.doesNotMatch(mvPanel, /(?:^|[^-])visibility:\s*hidden/m);
});

test('power saving hides dashboard work but keeps the YouTube MV WebView alive', () => {
  assert.match(mvPanel, /webview2-youtube-mv/);
  assert.doesNotMatch(lifecycle, /StopNativeMvPlayback/);
  assert.doesNotMatch(lifecycle, /kNativeMvPanelHostClass/);
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
  assert.match(
    nativeWindows,
    /PlaceNativeWindow\(hwnd, layout\.\*slot\.rect, nativeDashboardVisible_\)/,
  );
});

test('media cycle runs YouTube, Spotify podcast, then TVer for one hour each', () => {
  assert.match(composition, /#include "spotify_webviews\.h"/);
  assert.match(composition, /kNativeMvRandomActionTimerForMediaCycle = 0x4D560001/);
  assert.match(composition, /kMediaCycleHourMs = 60U \* 60U \* 1000U/);
  assert.match(composition, /kNativeMvPodcastAndTverPauseMs = 2U \* 60U \* 60U \* 1000U/);
  assert.match(composition, /#define SetTimer SetNativeMvTimerWithMediaCycle/);
  assert.match(
    composition,
    /const UINT effectiveDelay =\s*enteringPause \? kNativeMvPodcastAndTverPauseMs : kMediaCycleHourMs/,
  );
  assert.match(
    composition,
    /SetSpotifyAmazonPodcastMode\(true\)[\s\S]*kSakuraMeetsTverStartTimer[\s\S]*kMediaCycleHourMs/,
  );
  assert.match(
    composition,
    /SakuraMeetsTverStartTimerProc[\s\S]*SetSpotifyAmazonPodcastMode\(false\)[\s\S]*gSakuraMeetsTverPlayer\.Start\(hwnd\)/,
  );
});

test('TVer phase always returns through the Sakura Meets series page and latest episode', () => {
  assert.match(composition, /https:\/\/tver\.jp\/series\/srx97ftk3w/);
  assert.match(composition, /querySelectorAll\('a\[href\*="\/episodes\/"\]'\)/);
  assert.match(composition, /最新話\|最新回/);
  assert.match(composition, /放課後トーク\|予告/);
  assert.match(composition, /location\.replace\(latest\.href\)/);
  assert.match(composition, /video\.ended && state\.maxDuration >= 600 && state\.maxTime >= 300/);
  assert.match(composition, /location\.replace\(seriesUrl\)/);
  assert.match(composition, /video\.play\(\)/);
  assert.match(composition, /window\.setInterval\(ensure, 2000\)/);
  assert.match(
    composition,
    /SharedMediaUserDataFolder[\s\S]*L"data" \/ L"webview2-youtube-mv"/,
  );
  assert.match(
    composition,
    /SharedWebViewEnvironment::Instance\(\)\.Acquire\(\s*userDataFolder, false, false,/,
  );
});

test('YouTube uses stock WebView2 browser arguments while Stationhead optimizations stay isolated', () => {
  assert.match(mvPanel, /Acquire\(\s*userDataFolder_, false, false,/);
  assert.match(webviewEnvironment, /if \(!blockImages && !blockFonts\) return \{\};/);
  assert.match(webviewEnvironment, /kStationheadWebView2Arguments/);
  assert.match(webviewEnvironment, /--autoplay-policy=no-user-gesture-required/);
  assert.match(webviewEnvironment, /--disable-backgrounding-occluded-windows/);
  assert.match(webviewEnvironment, /options && !webView2Arguments\.empty\(\)/);
  assert.doesNotMatch(webviewEnvironment, /WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS/);
  assert.doesNotMatch(webviewEnvironment, /ApplyWebView2ProcessHints/);
});

test('normal YouTube page resources are enabled while privileged browser features stay disabled', () => {
  assert.match(mvPanel, /Acquire\(\s*userDataFolder_, false, false,/);
  assert.match(mvPanel, /put_IsWebMessageEnabled\(FALSE\)/);
  assert.match(mvPanel, /put_AreDefaultScriptDialogsEnabled\(FALSE\)/);
  assert.match(mvPanel, /put_AreDefaultContextMenusEnabled\(FALSE\)/);
  assert.match(mvPanel, /put_AreDevToolsEnabled\(FALSE\)/);
  assert.match(mvPanel, /put_IsStatusBarEnabled\(FALSE\)/);
  assert.match(mvPanel, /put_AreHostObjectsAllowed\(FALSE\)/);
  assert.match(mvPanel, /put_IsZoomControlEnabled\(FALSE\)/);
  assert.match(mvPanel, /put_AreBrowserAcceleratorKeysEnabled\(FALSE\)/);
  assert.match(mvPanel, /add_NewWindowRequested/);
  assert.match(mvPanel, /put_Handled\(TRUE\)/);
});

test('Stationhead audio is muted once when the MV surface becomes active', () => {
  assert.match(mvPanel, /static bool stationheadMuteQueued = false/);
  assert.match(mvPanel, /QueueAction\(UiAction::StationheadAudioMute\)/);
});