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
const layout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);
const core = readFileSync(
  new URL('../../native/src/spotify_webviews_core_part4.inc', import.meta.url),
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

test('Spotify trusted click uses one target-scoped eight-second gate', () => {
  assert.match(header, /ULONGLONG trustedClickGeneration = 0/);
  assert.match(header, /ULONGLONG trustedClickTargetGeneration = 0/);
  assert.match(header, /ULONGLONG trustedClickBlockedUntilTick = 0/);
  assert.doesNotMatch(header, /trustedClickInFlight|trustedClickStartTick/);
  assert.match(helper, /kSpotifyTrustedClickGateMs = 8ULL \* 1000ULL/);
  assert.match(
    helper,
    /slot\.trustedClickTargetGeneration == targetGeneration[\s\S]*now < slot\.trustedClickBlockedUntilTick[\s\S]*return 0;/,
  );
  assert.match(helper, /\+\+slot\.trustedClickGeneration/);
  assert.match(helper, /slot\.trustedClickTargetGeneration = targetGeneration/);
  assert.match(
    helper,
    /slot\.trustedClickBlockedUntilTick = now \+ kSpotifyTrustedClickGateMs/,
  );
  assert.match(
    helper,
    /target->trustedClickGeneration != clickGeneration[\s\S]*target->targetGeneration != targetGeneration[\s\S]*target->webview\.Get\(\) != view\.Get\(\)/,
  );
});

test('target changes and WebView rebuilds invalidate old trusted click chains', () => {
  assert.match(helper, /target->targetGeneration != targetGeneration/);
  assert.match(helper, /target->webview\.Get\(\) != view\.Get\(\)/);
  assert.match(core, /slot\.trustedClickTargetGeneration = 0/);
  assert.match(core, /slot\.trustedClickBlockedUntilTick = 0/);
});

test('parked Spotify surfaces are playback-only and recovery gets a desktop-like viewport', () => {
  assert.match(layout, /kSpotifyParkedPlaybackWidth = 320/);
  assert.match(layout, /kSpotifyParkedPlaybackHeight = 180/);
  assert.match(layout, /kSpotifyRecoveryInteractionWidth = 720/);
  assert.match(layout, /kSpotifyRecoveryInteractionHeight = 480/);
  assert.match(
    layout,
    /width = std::max\(activeWidth, kSpotifyRecoveryInteractionWidth\)/,
  );
  assert.match(
    layout,
    /height = std::max\(activeHeight, kSpotifyRecoveryInteractionHeight\)/,
  );
});

test('trusted click remeasures after responsive recovery layout instead of using a stale point', () => {
  assert.match(helper, /bool SpotifyWebViews::ParseNormalizedPoint/);
  assert.match(helper, /void SpotifyWebViews::ClickSlotNormalizedPoint/);
  assert.match(
    helper,
    /const bool recoveryViewportReady =\s*hostLayoutActiveSlot_ == slot\.index && SlotStateNeedsRecovery\(slot\.state\)/,
  );
  assert.match(
    helper,
    /if \(!recoveryViewportReady\) \{[\s\S]*MarkSlotRecovering\(slot, now\)[\s\S]*RefreshSpotifyHostLayout\(\);[\s\S]*ArmRobustScheduler\(\);[\s\S]*return;/,
  );
  assert.match(
    helper,
    /SetSlotState\(slot, SlotState::WaitingTarget\);\s*DispatchSpotifyDevToolsClick\(slot, xTenThousandths, yTenThousandths\);/,
  );
});
