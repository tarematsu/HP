import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bundle = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const layout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);
const staticScripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);

test('unfinished Spotify authentication keeps visual foreground ownership when no monitor slot is selected', () => {
  assert.match(layout, /foregroundAuthenticationIndex[\s\S]*SlotIsLoginPage\(slots_\[i\]\)/);
  assert.match(layout, /const bool authenticationForeground =\s*authentication && monitorForegroundSlot_ < 0/);
  assert.match(layout, /monitorForeground \|\| authenticationForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(layout, /if \(placementChanged\)/);
  assert.match(layout, /UINT flags = SWP_NOACTIVATE \| SWP_SHOWWINDOW/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter/);
  assert.match(layout, /hostLayoutAuthenticationSlot_ == foregroundAuthenticationIndex[\s\S]*maintainAuthenticationForeground\(false\);[\s\S]*return;/);
  assert.match(layout, /hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex;\s*PlaceHosts\(\);\s*maintainAuthenticationForeground\(true\);/);
  assert.match(layout, /SWP_NOMOVE \| SWP_NOSIZE \| SWP_NOACTIVATE/);
  assert.match(layout, /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\);/);
  assert.match(layout, /const int hostX = client\.left;/);
  assert.match(layout, /const int hostY = client\.top;/);
  assert.match(layout, /client\.right - client\.left/);
  assert.match(layout, /client\.bottom - client\.top/);
  assert.doesNotMatch(layout, /kSpotifyBackgroundWidth|kSpotifyBackgroundHeight|ComputeMediaSurfaceAnchors|anchors\.air|CenterMediaSurfaceOnAnchor|compactPlayback/);
});

test('authentication foreground repair is conditional instead of running every scheduler pass', () => {
  assert.match(layout, /monitorForegroundSlot_ >= 0/);
  assert.match(layout, /!layoutChanged && GetWindow\(slot\.hostWindow, GW_HWNDPREV\) != nullptr/);
  assert.doesNotMatch(layout, /maintainAuthenticationForeground[\s\S]{0,800}SetWindowPos\(slot\.hostWindow, HWND_TOP[\s\S]{0,200}else/);
});

test('three-window authentication does not install an account-label DOM bridge', () => {
  assert.doesNotMatch(bundle, /spotify_auth_badge\.inc/);
  assert.doesNotMatch(layout, /kSpotifyAuthenticationBadgeBootstrapScript|authenticationBadgeTick|ExecuteScript/);
  assert.doesNotMatch(staticScripts, /spotify:account|__homePanelSpotifyAccount|mountBadge/);
  assert.match(staticScripts, /L"yuukiar"/);
  assert.match(staticScripts, /L"ten"/);
  assert.match(staticScripts, /L"nagi"/);
  assert.doesNotMatch(staticScripts, /L"hinata"|L"amazon"|L"ozeki"/);
});
