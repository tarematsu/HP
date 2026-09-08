import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = [
  'spotify_webviews.cpp',
  'spotify_webviews_core_part1.inc',
  'spotify_webviews_core_part2.inc',
  'spotify_webviews_core_part3.inc',
  'spotify_webviews_core_part4.inc',
].map(name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8')).join('\n');
const layout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
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
  assert.match(spotify, /activeWidth = std::max\(1, clientWidth \* 3 \/ 5\)/);
  assert.match(spotify, /activeHeight = std::max\(1, clientHeight \* 9 \/ 10\)/);
  assert.match(spotify, /const bool active = static_cast<int>\(i\) == activeIndex/);
  assert.match(spotify, /const bool authentication = active && SlotIsLoginPage\(slot\)/);
  assert.match(spotify, /SlotStateNeedsRecovery\(slot\.state\)/);
  assert.match(spotify, /x = client\.right \+ 32/);
  assert.match(header, /hostLayoutAuthenticationVisible_ = false/);
});

test('the active Spotify WebView uses 80 percent page zoom in foreground or background', () => {
  assert.match(layout, /kSpotifySerializedRecoveryZoom = 0\.80/);
  assert.match(layout, /controller->get_ZoomFactor\(&zoom\)/);
  assert.match(layout, /controller->put_ZoomFactor\(kSpotifySerializedRecoveryZoom\)/);
});

test('trusted CDP clicks compensate for WebView2 zoom before dispatch', () => {
  assert.match(click, /controller->get_ZoomFactor\(&controllerZoom\)/);
  assert.match(click, /cssWidth = static_cast<double>\(width\) \/ zoom/);
  assert.match(click, /cssHeight = static_cast<double>\(height\) \/ zoom/);
  assert.match(click, /Input\.dispatchMouseEvent/);
});

test('initial account starts remain 40 seconds apart then healthy verification rotates every 20 seconds', () => {
  assert.match(schedule, /kSpotifyTimedSlotOffsetMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifyInitialSerialWindowMs = 6ULL \* 40ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifySimpleSteadyTurnMs = 20ULL \* 1000ULL/);
  assert.match(schedule, /elapsed < kSpotifyInitialSerialWindowMs[\s\S]*elapsed \/ kSpotifyTimedSlotOffsetMs/);
  assert.match(schedule, /elapsed - kSpotifyInitialSerialWindowMs[\s\S]*kSpotifySimpleSteadyTurnMs/);
});

test('authentication gets at most one 40-second hold instead of blocking other accounts', () => {
  assert.match(schedule, /kSpotifyAuthenticationHoldMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /const bool currentAuthentication =[\s\S]*SlotIsLoginPage/);
  assert.match(schedule, /const bool holdAuthentication =[\s\S]*kSpotifyAuthenticationHoldMs/);
  assert.match(schedule, /!holdAuthentication && !holdRecovery/);
});

test('recovery also has a bounded hold so one slow account cannot monopolize the viewport', () => {
  assert.match(schedule, /kSpotifySimpleRecoveryHoldMs = 12ULL \* 1000ULL/);
  assert.match(schedule, /const bool holdRecovery/);
  assert.match(schedule, /SlotStateNeedsRecovery\(current\.state\)/);
  assert.match(schedule, /!holdAuthentication && !holdRecovery/);
});

test('each scheduler ownership pass refreshes layout before returning for login', () => {
  assert.match(
    schedule,
    /Slot& slot = slots_\[staggerSlotIndex_\];[\s\S]*RefreshSpotifyHostLayout\(\);[\s\S]*if \(slot\.webview && SlotIsLoginPage\(slot\)\) return;/,
  );
});

test('login state participates in layout cache so redirect can surface authentication immediately', () => {
  assert.match(layout, /const bool authenticationVisible =[\s\S]*SlotIsLoginPage\(slots_\[activeIndex\]\)/);
  assert.match(layout, /hostLayoutAuthenticationVisible_ == authenticationVisible[\s\S]*return;/);
  assert.match(layout, /hostLayoutAuthenticationVisible_ = authenticationVisible/);
});
