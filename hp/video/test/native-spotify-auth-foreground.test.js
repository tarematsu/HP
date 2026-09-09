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
const authBadge = readFileSync(
  new URL('../../native/src/spotify_auth_badge.inc', import.meta.url),
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
    /if \(authentication\)[\s\S]*insertAfter = HWND_TOP;/,
  );
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
  assert.match(
    layout,
    /const bool recovery =\s*i == hostLayoutActiveSlot_ && !authentication &&\s*SlotStateNeedsRecovery\(slot\.state\);/,
  );
});

test('authentication foreground repair is conditional instead of running every scheduler pass', () => {
  assert.match(
    layout,
    /!layoutChanged && GetWindow\(slot\.hostWindow, GW_HWNDPREV\) != nullptr/,
  );
  assert.doesNotMatch(layout, /maintainAuthenticationForeground[\s\S]{0,800}SetWindowPos\(slot\.hostWindow, HWND_TOP[\s\S]{0,200}else/);
});

test('authentication page receives the established six-window account label once per document', () => {
  assert.match(bundle, /#include "spotify_auth_badge\.inc"/);
  assert.match(authBadge, /kSpotifyAuthenticationBadgeBootstrapScript/);
  assert.match(authBadge, /fields\[0\] === 'spotify:account'/);
  assert.match(layout, /if \(slot\.authenticationBadgeTick != 0\) return/);
  assert.match(layout, /ExecuteScript\(\s*kSpotifyAuthenticationBadgeBootstrapScript/);
  assert.match(layout, /PostSpotifyPageContext\(\*target\)/);
  assert.match(
    staticScripts,
    /L"amazon", L"yuukiar", L"ten", L"nagi", L"hinata", L"ozeki"/,
  );
});