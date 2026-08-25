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

test('MV playlist reloads hourly and starts Play all with DOM-first native input', () => {
  assert.match(mvPanel, /kNativeMvHourlyReloadTimer/);
  assert.match(mvPanel, /kNativeMvHourlyReloadMs = 60U \* 60U \* 1000U/);
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

test('MV WebView keeps its persistent profile and stays alive behind power saving', () => {
  assert.match(mvPanel, /webview2-youtube-mv/);
  assert.match(
    nativeWindows,
    /keepMvPlaybackVisible = requestedDashboardVisible_ && powerSavingMode_/,
  );
  assert.match(
    nativeWindows,
    /nativeDashboardVisible_ \|\|\s*\(keepMvPlaybackVisible && hwnd == nativeRadarWindow_\)/,
  );
  assert.match(
    nativeWindows,
    /EnsureNativeMvPanel\(nativeRadarWindow_, dataDir_, mvBounds\)/,
  );
  assert.match(webviewEnvironment, /--disable-backgrounding-occluded-windows/);
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
