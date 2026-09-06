import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const guard = readFileSync(
  new URL('../../native/src/spotify_lonesome_guard.inc', import.meta.url),
  'utf8',
);
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url),
  'utf8',
);
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);

test('serialized Spotify shows only authentication and performs normal recovery offscreen', () => {
  assert.match(guard, /activeWidth = std::max\(1, clientWidth \* 3 \/ 5\)/);
  assert.match(guard, /activeHeight = std::max\(1, clientHeight \* 9 \/ 10\)/);
  assert.match(guard, /staggerSlotIndex_ % owner->slots_\.size\(\)/);
  assert.match(guard, /const bool authentication =[\s\S]*SlotIsLoginPage\(\*slot\)/);
  assert.match(guard, /ExpandSpotifyAuthenticationHost/);
  assert.match(guard, /PrepareSpotifyBackgroundRecoveryHost/);
  assert.match(guard, /\*x = parentClient\.right \+ 32/);
  assert.match(header, /hostLayoutAuthenticationVisible_ = false/);
});

test('the active Spotify WebView uses 80 percent page zoom in foreground or background', () => {
  assert.match(guard, /kSpotifySerializedRecoveryZoom = 0\.80/);
  assert.match(guard, /controller->get_ZoomFactor\(&zoom\)/);
  assert.match(guard, /controller->put_ZoomFactor\(kSpotifySerializedRecoveryZoom\)/);
});

test('trusted CDP clicks compensate for WebView2 zoom before dispatch', () => {
  assert.match(click, /controller->get_ZoomFactor\(&controllerZoom\)/);
  assert.match(click, /cssWidth = static_cast<double>\(width\) \/ zoom/);
  assert.match(click, /cssHeight = static_cast<double>\(height\) \/ zoom/);
  assert.match(click, /Input\.dispatchMouseEvent/);
});

test('initial account starts remain 40 seconds apart then recovery rotates every 15 seconds', () => {
  assert.match(schedule, /kSpotifyTimedSlotOffsetMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyInitialSerialWindowMs = 6ULL \* 40ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifySimpleSteadyTurnMs = 15ULL \* 1000ULL/);
  assert.match(
    schedule,
    /elapsed < kSpotifyInitialSerialWindowMs[\s\S]*elapsed \/ kSpotifyTimedSlotOffsetMs/,
  );
  assert.match(
    schedule,
    /elapsed - kSpotifyInitialSerialWindowMs[\s\S]*kSpotifySimpleSteadyTurnMs/,
  );
});

test('authentication gets at most one 40-second hold instead of blocking other accounts', () => {
  assert.match(schedule, /kSpotifyAuthenticationHoldMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /const bool currentAuthentication =[\s\S]*SlotIsLoginPage/);
  assert.match(schedule, /const bool holdAuthentication =[\s\S]*kSpotifyAuthenticationHoldMs/);
  assert.match(schedule, /!holdAuthentication && !holdRecovery/);
});

test('each simple scheduler tick refreshes layout before returning for login', () => {
  assert.match(
    schedule,
    /Slot& slot = slots_\[staggerSlotIndex_\];[\s\S]*RefreshSpotifyHostLayout\(\);[\s\S]*if \(slot\.webview && SlotIsLoginPage\(slot\)\) return;/,
  );
});

test('login state participates in layout cache so a redirect can surface authentication immediately', () => {
  assert.match(guard, /const bool authenticationVisible =[\s\S]*SlotIsLoginPage\(slots_\[activeIndex\]\)/);
  assert.match(
    guard,
    /hostLayoutAuthenticationVisible_ == authenticationVisible[\s\S]*return;/,
  );
  assert.match(guard, /hostLayoutAuthenticationVisible_ = authenticationVisible/);
});
