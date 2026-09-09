import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const helper = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url),
  'utf8',
);
const phaseSync = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);

test('Spotify recovery clicks use only WebView2 CDP trusted input', () => {
  assert.match(wrapper, /#include "spotify_background_click\.inc"/);
  assert.doesNotMatch(wrapper, /#define SendInput|#define ExecuteScript/);
  assert.match(helper, /CallDevToolsProtocolMethod\(/);
  assert.match(helper, /L"Input\.dispatchMouseEvent"/);
  assert.match(helper, /mouseMoved[\s\S]*mousePressed[\s\S]*mouseReleased/);
  assert.doesNotMatch(helper, /SetForegroundWindow|SendInput|MOUSEEVENTF_/);
});

test('Spotify trusted click is single-flight with bounded stale recovery', () => {
  assert.match(header, /ULONGLONG trustedClickGeneration = 0/);
  assert.match(header, /ULONGLONG trustedClickStartTick = 0/);
  assert.match(header, /bool trustedClickInFlight = false/);
  assert.match(helper, /kSpotifyTrustedClickStaleMs = 8ULL \* 1000ULL/);
  assert.match(helper, /if \(slot\.trustedClickInFlight\)/);
  assert.match(helper, /return 0;/);
  assert.match(helper, /\+\+slot\.trustedClickGeneration/);
  assert.match(helper, /const ULONGLONG clickGeneration = slot\.trustedClickGeneration/);
  assert.match(helper, /target->trustedClickGeneration != clickGeneration/);
  assert.match(helper, /slot\.trustedClickInFlight = true/);
  assert.match(
    helper,
    /mouseReleased[\s\S]*target->trustedClickGeneration !=[\s\S]*clickGeneration[\s\S]*target->trustedClickInFlight = false;[\s\S]*target->trustedClickStartTick = 0;/,
  );
});

test('trusted recovery refreshes the owner layout exactly once before dispatch', () => {
  assert.match(
    phaseSync,
    /SetSlotState\(slot, SlotState::WaitingTarget\);\s*RefreshSpotifyHostLayout\(\);\s*DispatchSpotifyDevToolsClick\(slot, xTenThousandths, yTenThousandths\);/,
  );
  assert.doesNotMatch(header, /RecomputeForegroundAndRefreshSpotifyHostLayout/);
  assert.doesNotMatch(helper, /RecomputeForegroundAndRefreshSpotifyHostLayout/);
});
