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

test('unfinished Spotify authentication keeps visual foreground ownership without owning playback recovery', () => {
  assert.match(
    layout,
    /foregroundAuthenticationIndex[\s\S]*SlotIsLoginPage\(slots_\[i\]\)/,
  );
  assert.match(
    layout,
    /authentication \|\| monitorForeground_ \? HWND_TOP : HWND_BOTTOM/,
  );
  assert.doesNotMatch(layout, /client\.right \+ 1|client\.bottom \+ 1/);
  assert.match(layout, /if \(placementChanged\)/);
  assert.match(layout, /UINT flags = SWP_NOACTIVATE \| SWP_SHOWWINDOW/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter/);
  assert.match(
    layout,
    /hostLayoutAuthenticationSlot_ == foregroundAuthenticationIndex[\s\S]*maintainAuthenticationForeground\(false\);[\s\S]*return;/,
  );
  assert.match(
    layout,
    /hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex;\s*PlaceHosts\(\);\s*maintainAuthenticationForeground\(true\);/,
  );
  assert.match(layout, /SWP_NOMOVE \| SWP_NOSIZE \| SWP_NOACTIVATE/);
  assert.match(
    layout,
    /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\);/,
  );
  assert.match(layout, /kSpotifyBackgroundWidth = 160/);
  assert.match(layout, /kSpotifyBackgroundHeight = 320/);
  assert.match(layout, /ComputeMediaSurfaceAnchors\(client\)/);
  assert.match(layout, /anchors\.air/);
  assert.match(layout, /CenterMediaSurfaceOnAnchor/);
  assert.doesNotMatch(layout, /width = clientWidth|height = clientHeight/);
  assert.doesNotMatch(layout, /compactPlayback/);
});

test('authentication foreground repair is conditional instead of running every scheduler pass', () => {
  assert.match(
    layout,
    /!layoutChanged && GetWindow\(slot\.hostWindow, GW_HWNDPREV\) != nullptr/,
  );
  assert.doesNotMatch(layout, /maintainAuthenticationForeground[\s\S]{0,800}SetWindowPos\(slot\.hostWindow, HWND_TOP[\s\S]{0,200}else/);
});

test('single-window authentication does not install an account-label DOM bridge', () => {
  assert.doesNotMatch(bundle, /spotify_auth_badge\.inc/);
  assert.doesNotMatch(layout, /kSpotifyAuthenticationBadgeBootstrapScript|authenticationBadgeTick|ExecuteScript/);
  assert.doesNotMatch(staticScripts, /spotify:account|__homePanelSpotifyAccount|mountBadge/);
  assert.match(staticScripts, /L"yuukiar"/);
  assert.doesNotMatch(staticScripts, /L"ten"|L"nagi"|L"hinata"|L"amazon"|L"ozeki"/);
});