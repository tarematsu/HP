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
const powerSaving = readFileSync(
  new URL('../../native/src/power_saving_controller.cpp', import.meta.url),
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

test('MV playback uses the requested YouTube playlist without autoplay query', () => {
  assert.match(mvPanel, /PLMWqSdpIVl30/);
  assert.match(mvPanel, /youtube\.com\/embed\/videoseries/);
  assert.doesNotMatch(mvPanel, /autoplay=1/);
  assert.match(mvPanel, /loop=1/);
  assert.match(mvPanel, /controls=1/);
});

test('MV center click runs once after startup and then every hour', () => {
  assert.match(mvPanel, /kNativeMvClickTimer = 0x4D56/);
  assert.match(mvPanel, /kNativeMvInitialClickDelayMs = 5'000/);
  assert.match(mvPanel, /kNativeMvHourlyClickIntervalMs = 60U \* 60U \* 1000U/);
  assert.match(
    mvPanel,
    /SetTimer\(hostWindow_, kNativeMvClickTimer,\s*kNativeMvInitialClickDelayMs, nullptr\)/,
  );
  assert.match(
    mvPanel,
    /SetTimer\(hostWindow_, kNativeMvClickTimer,\s*kNativeMvHourlyClickIntervalMs, nullptr\)/,
  );
  assert.match(mvPanel, /ClickCenter\(\)/);
});

test('native MV click is one guarded Windows input batch at the panel center', () => {
  assert.match(mvPanel, /GetForegroundWindow\(\) != root/);
  assert.match(mvPanel, /WindowFromPoint\(center\)/);
  assert.match(mvPanel, /hit != hostWindow_ && !IsChild\(hostWindow_, hit\)/);
  assert.match(mvPanel, /ClientToScreen\(hostWindow_, &center\)/);
  assert.match(mvPanel, /GetCursorPos\(&previous\)/);
  assert.match(mvPanel, /INPUT input\[4\]/);
  assert.match(mvPanel, /MOUSEEVENTF_MOVE \| MOUSEEVENTF_ABSOLUTE \| MOUSEEVENTF_VIRTUALDESK/);
  assert.match(mvPanel, /MOUSEEVENTF_LEFTDOWN/);
  assert.match(mvPanel, /MOUSEEVENTF_LEFTUP/);
  assert.match(mvPanel, /SendInput\(kInputCount, input, sizeof\(INPUT\)\)/);
});

test('MV click system has no YouTube frame monitoring, retries, or injected DOM click logic', () => {
  assert.doesNotMatch(mvPanel, /add_FrameNavigationStarting\(/);
  assert.doesNotMatch(mvPanel, /add_FrameNavigationCompleted\(/);
  assert.doesNotMatch(mvPanel, /youtubeFrameNavigationId_/);
  assert.doesNotMatch(mvPanel, /autoStartAttempts_/);
  assert.doesNotMatch(mvPanel, /autoStartClickSent_/);
  assert.doesNotMatch(mvPanel, /AddScriptToExecuteOnDocumentCreated\(/);
  assert.doesNotMatch(mvPanel, /ytp-large-play-button/);
  assert.doesNotMatch(mvPanel, /ytp-play-button/);
  assert.doesNotMatch(mvPanel, /button\.click\(\)/);
  assert.doesNotMatch(mvPanel, /querySelector\(['"]video['"]\)/);
});

test('MV WebView stays alive behind the power-saving overlay', () => {
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

test('power saving briefly exposes the MV when the fixed native click timer fires', () => {
  assert.match(mvPanel, /kNativeMvClickTimer = 0x4D56/);
  assert.match(powerSaving, /kObservedNativeMvAutoStartTimer = 0x4D56/);
  assert.match(powerSaving, /kMvStartupPassHoldMs = 1'500/);
  assert.match(powerSaving, /IsMvPanelWindow\(message\.hwnd\)/);
  assert.match(powerSaving, /OpenMvStartupInputPass\(\)/);
  assert.match(
    powerSaving,
    /SetTimer\(overlay_, kMvStartupPassTimer, kMvStartupPassHoldMs, nullptr\)/,
  );
  assert.match(
    powerSaving,
    /if \(!powerSaving_ \|\| mvStartupInputPass_\) target = ParentButtonRect\(\)/,
  );
  assert.match(powerSaving, /CloseMvStartupInputPass\(\)/);
});

test('MV is enclosed by a local HTTPS page so YouTube receives a normal Referer', () => {
  assert.match(mvPanel, /kNativeMvPanelHtml/);
  assert.match(mvPanel, /https:\/\/homepanel\.mv\/index\.html/);
  assert.match(mvPanel, /SetVirtualHostNameToFolderMapping\(/);
  assert.match(mvPanel, /referrerpolicy="strict-origin-when-cross-origin"/);
  assert.match(mvPanel, /<iframe/);
  assert.match(mvPanel, /PreparePlayerHtml\(\)/);
  assert.match(mvPanel, /assetFolder_/);
  assert.doesNotMatch(mvPanel, /kNativeMvReferer/);
  assert.doesNotMatch(mvPanel, /NavigateWithWebResourceRequest\(/);
  assert.doesNotMatch(mvPanel, /CreateWebResourceRequest\(/);
});

test('waste calendar overlays the MV at top-right without taking pointer input', () => {
  assert.match(mvPanel, /id="waste"/);
  assert.match(mvPanel, /#waste\{position:absolute;z-index:2;top:12px;right:12px;/);
  assert.match(mvPanel, /opacity:\.42;pointer-events:none/);
  assert.match(mvPanel, /grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
  assert.match(mvPanel, /ごみ収集カレンダー/);
  assert.match(mvPanel, /コース36/);
  assert.match(mvPanel, /setInterval\(renderWaste, 60_000\)/);
});

test('waste overlay is generated from the native course 36 schedule', () => {
  assert.match(mvPanel, /BuildCourse36WasteScheduleJson\(\)/);
  assert.match(mvPanel, /Course36WasteForDate\(date\)/);
  assert.match(mvPanel, /__COURSE36_SCHEDULE__/);
  assert.match(mvPanel, /html\.replace\(marker, sizeof\(kScheduleMarker\) - 1,/);
  assert.match(mvPanel, /const schedule = __COURSE36_SCHEDULE__;/);
});

test('MV wrapper stays minimal and does not restore iframe API playlist machinery', () => {
  assert.doesNotMatch(mvPanel, /youtube\.com\/iframe_api/);
  assert.doesNotMatch(mvPanel, /crypto\.getRandomValues/);
  assert.doesNotMatch(mvPanel, /cuePlaylist/);
  assert.doesNotMatch(mvPanel, /playVideoAt/);
});

test('MV WebView is restricted to playback-only browser features', () => {
  assert.match(mvPanel, /Acquire\(\s*userDataFolder_, true, true,/);
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
