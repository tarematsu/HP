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

test('MV random cycle clicks center after 20:00-39:59, then reloads the playlist after another fresh 20:00-39:59', () => {
  assert.match(mvPanel, /kNativeMvRandomActionTimer/);
  assert.match(mvPanel, /kNativeMvRandomMinSeconds = 20U \* 60U/);
  assert.match(mvPanel, /kNativeMvRandomSpanSeconds = 20U \* 60U/);
  assert.match(mvPanel, /random % kNativeMvRandomSpanSeconds/);
  assert.match(mvPanel, /return seconds \* 1000U/);
  assert.match(mvPanel, /ScheduleNextRandomAction\(\)/);
  assert.match(mvPanel, /kNativeMvCenterXTenThousandths = 5000/);
  assert.match(mvPanel, /kNativeMvCenterYTenThousandths = 5000/);
  assert.match(mvPanel, /nextRandomActionIsCenterClick_ = true/);
  assert.match(
    mvPanel,
    /if \(timerId == kNativeMvRandomActionTimer\) \{\s*if \(nextRandomActionIsCenterClick_\) \{\s*ClickNormalizedPoint\(kNativeMvCenterXTenThousandths,\s*kNativeMvCenterYTenThousandths\);\s*nextRandomActionIsCenterClick_ = false;\s*if \(!failed_ && !ScheduleNextRandomAction\(\)\) Fail\(\);\s*\} else \{\s*ReloadPlaylist\(\);\s*\}/s,
  );
  assert.match(
    mvPanel,
    /void ReloadPlaylist\(\) noexcept \{[\s\S]*nextRandomActionIsCenterClick_ = true;[\s\S]*Navigate\(kNativeMvPanelPageUrl\)[\s\S]*ScheduleNextRandomAction\(\)/,
  );
  assert.doesNotMatch(mvPanel, /kNativeMvReloadTimer/);
  assert.doesNotMatch(mvPanel, /ScheduleNextPlaylistReload/);
  assert.match(mvPanel, /add_NavigationCompleted/);
  assert.match(mvPanel, /ExecuteScript/);
  assert.match(mvPanel, /すべて再生/);
  assert.match(mvPanel, /Play all/);
  assert.match(mvPanel, /ClientToScreen/);
  assert.match(mvPanel, /SendInput/);
  assert.match(mvPanel, /kNativeMvFallbackPlayAllXTenThousandths = 5850/);
  assert.match(mvPanel, /kNativeMvFallbackPlayAllYTenThousandths = 4250/);
  assert.match(mvPanel, /case WM_TIMER:/);
  assert.match(mvPanel, /ReloadPlaylist\(\)/);
  assert.doesNotMatch(mvPanel, /SendMouseInput/);
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
  assert.match(mvPanel, /kNativeMvPlaybackHealthMs = 5U \* 1000U/);
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

test('MV playback keeps YouTube transition chrome visually hidden', () => {
  assert.match(mvPanel, /homepanel-youtube-clean-player/);
  assert.match(mvPanel, /\.ytp-chrome-top/);
  assert.match(mvPanel, /\.ytp-gradient-top/);
  assert.match(mvPanel, /\.ytp-chrome-bottom/);
  assert.match(mvPanel, /\.ytp-gradient-bottom/);
  assert.match(mvPanel, /opacity:\s*0\s*!important/);
  assert.match(mvPanel, /transition:\s*none\s*!important/);
  assert.doesNotMatch(mvPanel, /visibility:\s*hidden/);
});

test('power saving stops the YouTube WebView and blocks periodic URL loading', () => {
  assert.match(mvPanel, /webview2-youtube-mv/);
  assert.match(lifecycle, /kNativeMvPanelHostClass\[\] = L"HomePanelNativeMvPanel"/);
  assert.match(
    lifecycle,
    /FindWindowExW\(\s*radarWindow, nullptr, kNativeMvPanelHostClass, nullptr\)/s,
  );
  assert.match(
    lifecycle,
    /if \(mvWindow && IsWindow\(mvWindow\)\) DestroyWindow\(mvWindow\)/,
  );
  assert.match(
    lifecycle,
    /void Renderer::SetPowerSavingMode\(bool enabled\)[\s\S]*if \(enabled\) StopNativeMvPlayback\(nativeRadarWindow_\);[\s\S]*ApplyDashboardVisibility\(\)/,
  );
  assert.match(
    lifecycle,
    /if \(powerSavingMode_\) StopNativeMvPlayback\(nativeRadarWindow_\)/,
  );
  assert.match(
    nativeWindows,
    /if \(nativeDashboardVisible_ && nativeRadarWindow_ && IsWindow\(nativeRadarWindow_\)\)/,
  );
  assert.match(
    nativeWindows,
    /PlaceNativeWindow\(hwnd, layout\.\*slot\.rect, nativeDashboardVisible_\)/,
  );
  assert.doesNotMatch(nativeWindows, /keepMvPlaybackVisible/);
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
