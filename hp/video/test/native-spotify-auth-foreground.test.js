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
const lifecycle = readFileSync(
  new URL('../../native/src/spotify_controller_lifecycle.inc', import.meta.url),
  'utf8',
);
const staticScripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);

test('unfinished Spotify authentication keeps full-client foreground ownership outside Monitor S', () => {
  assert.match(layout, /foregroundAuthenticationIndex[\s\S]*SlotIsLoginPage\(slots_\[i\]\)/);
  assert.match(layout, /const bool authenticationForeground =\s*authentication && monitorForegroundSlot_ < 0/);
  assert.match(layout, /const RECT fullClient\{hostX, hostY, hostX \+ width, hostY \+ height\}/);
  assert.match(layout, /const RECT desired = loginPage \? fullClient : serviceTile/);
  assert.match(layout, /gridForeground \|\| monitorForeground \|\| authenticationForeground/);
  assert.match(layout, /if \(placementChanged\)/);
  assert.match(layout, /UINT flags = SWP_NOACTIVATE \| SWP_SHOWWINDOW/);
  assert.match(layout, /SetWindowPos\(slot\.hostWindow, insertAfter/);
  assert.match(layout, /hostLayoutAuthenticationSlot_ == foregroundAuthenticationIndex[\s\S]*maintainAuthenticationForeground\(false\);[\s\S]*return;/);
  assert.match(layout, /hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex;\s*PlaceHosts\(\);\s*maintainAuthenticationForeground\(true\);/);
  assert.match(layout, /SWP_NOMOVE \| SWP_NOSIZE \| SWP_NOACTIVATE/);
  assert.match(layout, /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\);/);
});

test('Spotify email verification challenge remains inside the authentication foreground flow', () => {
  assert.match(
    lifecycle,
    /StartsWithInsensitive\(value, L"https:\/\/challenge\.spotify\.com\/"\)/,
  );
  assert.match(lifecycle, /target->loginPage = IsSpotifyLoginUri\(rawUri\)/);
  assert.match(
    lifecycle,
    /target->loginPage \? SlotState::Authenticating : SlotState::Navigating/,
  );
});

test('authentication foreground repair is conditional instead of running every scheduler pass', () => {
  assert.match(layout, /monitorForegroundSlot_ >= 0/);
  assert.match(layout, /!layoutChanged && GetWindow\(slot\.hostWindow, GW_HWNDPREV\) != nullptr/);
  assert.doesNotMatch(layout, /maintainAuthenticationForeground[\s\S]{0,800}SetWindowPos\(slot\.hostWindow, HWND_TOP[\s\S]{0,200}else/);
});

test('five-account authentication does not install an account-label DOM bridge', () => {
  assert.doesNotMatch(bundle, /spotify_auth_badge\.inc/);
  assert.doesNotMatch(layout, /kSpotifyAuthenticationBadgeBootstrapScript|authenticationBadgeTick|ExecuteScript/);
  assert.doesNotMatch(staticScripts, /spotify:account|__homePanelSpotifyAccount|mountBadge/);
  assert.match(staticScripts, /L"amazon"/);
  assert.match(staticScripts, /L"yuukiar"/);
  assert.match(staticScripts, /L"ten"/);
  assert.match(staticScripts, /L"nagi"/);
  assert.match(staticScripts, /L"hinata"/);
  assert.doesNotMatch(staticScripts, /L"ozeki"/);
});
