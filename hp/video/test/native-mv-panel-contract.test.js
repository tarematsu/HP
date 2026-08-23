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

test('MV playback auto-clicks the native YouTube player control after load', () => {
  assert.match(mvPanel, /kNativeMvAutoStartScript/);
  assert.match(mvPanel, /AddScriptToExecuteOnDocumentCreated\(/);
  assert.match(mvPanel, /ytp-large-play-button/);
  assert.match(mvPanel, /ytp-play-button/);
  assert.match(mvPanel, /button\.click\(\)/);
  assert.match(mvPanel, /attempts >= 20/);
  assert.match(mvPanel, /}, 500\)/);
});

test('MV navigation supplies desktop WebView2 client identity for YouTube', () => {
  assert.match(mvPanel, /kNativeMvReferer/);
  assert.match(mvPanel, /ICoreWebView2Environment2/);
  assert.match(mvPanel, /CreateWebResourceRequest\(/);
  assert.match(mvPanel, /SetHeader\(L"Referer", kNativeMvReferer\)/);
  assert.match(mvPanel, /NavigateWithWebResourceRequest\(/);
  assert.doesNotMatch(mvPanel, /webview_->Navigate\(kNativeMvPlaylistUrl\)/);
});

test('MV playback no longer runs local iframe API playlist machinery', () => {
  assert.doesNotMatch(mvPanel, /kNativeMvPanelHtml/);
  assert.doesNotMatch(mvPanel, /youtube\.com\/iframe_api/);
  assert.doesNotMatch(mvPanel, /crypto\.getRandomValues/);
  assert.doesNotMatch(mvPanel, /cuePlaylist/);
  assert.doesNotMatch(mvPanel, /playVideoAt/);
  assert.doesNotMatch(mvPanel, /SetVirtualHostNameToFolderMapping/);
  assert.doesNotMatch(mvPanel, /PreparePlayerHtml/);
  assert.doesNotMatch(mvPanel, /assetFolder_/);
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
