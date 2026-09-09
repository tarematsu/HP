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
const placement = readFileSync(
  new URL('../../native/src/spotify_webviews_core_part4.inc', import.meta.url),
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
    /SetWindowPos\(slot\.hostWindow, HWND_TOP,[\s\S]*SWP_NOACTIVATE \| SWP_SHOWWINDOW\)/,
  );
  assert.match(
    layout,
    /hostLayoutAuthenticationSlot_ == foregroundAuthenticationIndex[\s\S]*maintainAuthenticationForeground\(false\);[\s\S]*return;/,
  );
  assert.match(
    layout,
    /hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex;\s*PlaceHosts\(\);\s*maintainAuthenticationForeground\(true\);/,
  );
  assert.match(
    layout,
    /SWP_NOMOVE \| SWP_NOSIZE \| SWP_NOACTIVATE/,
  );
  assert.match(
    placement,
    /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\);/,
  );
  assert.match(
    placement,
    /const bool recovery =\s*i == hostLayoutActiveSlot_ && !authentication &&\s*SlotStateNeedsRecovery\(slot\.state\);/,
  );
});

test('authentication page receives the established six-window account label', () => {
  assert.match(bundle, /#include "spotify_auth_badge\.inc"/);
  assert.match(authBadge, /kSpotifyAuthenticationBadgeBootstrapScript/);
  assert.match(authBadge, /fields\[0\] === 'spotify:account'/);
  assert.match(layout, /ExecuteScript\(\s*kSpotifyAuthenticationBadgeBootstrapScript/);
  assert.match(layout, /PostSpotifyPageContext\(\*target\)/);
  assert.match(
    staticScripts,
    /L"amazon", L"yuukiar", L"ten", L"nagi", L"hinata", L"ozeki"/,
  );
});
