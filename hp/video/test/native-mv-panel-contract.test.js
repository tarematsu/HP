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
const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
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

test('MV startup clicks the WebView center from native Windows input after YouTube frame load', () => {
  assert.match(mvPanel, /add_FrameNavigationStarting\(/);
  assert.match(mvPanel, /add_FrameNavigationCompleted\(/);
  assert.match(mvPanel, /https:\/\/www\.youtube\.com\/embed\/videoseries/);
  assert.match(mvPanel, /youtubeFrameNavigationId_/);
  assert.match(mvPanel, /ScheduleAutoStartClick\(\)/);
  assert.match(mvPanel, /client\.left \+ \(client\.right - client\.left\) \/ 2/);
  assert.match(mvPanel, /client\.top \+ \(client\.bottom - client\.top\) \/ 2/);
  assert.match(mvPanel, /ClientToScreen\(hostWindow_, &center\)/);
  assert.match(mvPanel, /SendInput\(kInputCount, input, sizeof\(INPUT\)\)/);
  assert.match(mvPanel, /MOUSEEVENTF_LEFTDOWN/);
  assert.match(mvPanel, /MOUSEEVENTF_LEFTUP/);
});

test('native MV click is guarded against background or covered-window misclicks', () => {
  assert.match(mvPanel, /GetForegroundWindow\(\) != root/);
  assert.match(mvPanel, /WindowFromPoint\(center\)/);
  assert.match(mvPanel, /hit != hostWindow_ && !IsChild\(hostWindow_, hit\)/);
  assert.match(mvPanel, /GetCursorPos\(&previousCursor\)/);
  assert.match(mvPanel, /SetCursorPos\(center\.x, center\.y\)/);
  assert.match(mvPanel, /SetCursorPos\(previousCursor\.x, previousCursor\.y\)/);
  assert.match(mvPanel, /autoStartClickSent_ = true/);
  assert.match(mvPanel, /kNativeMvAutoStartMaxAttempts = 20/);
});

test('MV startup does not depend on YouTube DOM selectors or injected click JavaScript', () => {
  assert.doesNotMatch(mvPanel, /AddScriptToExecuteOnDocumentCreated\(/);
  assert.doesNotMatch(mvPanel, /ytp-large-play-button/);
  assert.doesNotMatch(mvPanel, /ytp-play-button/);
  assert.doesNotMatch(mvPanel, /button\.click\(\)/);
  assert.doesNotMatch(mvPanel, /querySelector\(['"]video['"]\)/);
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