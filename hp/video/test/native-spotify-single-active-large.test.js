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

test('serialized Spotify shows authentication while normal recovery remains offscreen', () => {
  assert.match(spotify, /activeWidth = std::max\(1, clientWidth \* 3 \/ 5\)/);
  assert.match(spotify, /activeHeight = std::max\(1, clientHeight \* 9 \/ 10\)/);
  assert.match(spotify, /const bool active = static_cast<int>\(i\) == activeIndex/);
  assert.match(
    spotify,
    /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\)/,
  );
  assert.match(spotify, /SlotStateNeedsRecovery\(slot\.state\)/);
  assert.match(spotify, /x = client\.right \+ 32/);
  assert.match(header, /hostLayoutAuthenticationSlot_ = kAccountCount/);
});

test('inactive Spotify playback hosts never collapse to 1x1', () => {
  assert.match(spotify, /kSpotifyParkedPlaybackWidth = 320/);
  assert.match(spotify, /kSpotifyParkedPlaybackHeight = 180/);
  assert.match(spotify, /static_cast<int>\(i\) \*[\s\S]*kSpotifyParkedPlaybackWidth \+ kSpotifyParkedPlaybackGap/);
  assert.doesNotMatch(spotify, /int width = 1;\s*int height = 1/);
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

test('authentication foreground never extends scheduler ownership', () => {
  assert.doesNotMatch(schedule, /kSpotifyAuthenticationHoldMs|holdAuthentication/);
  assert.match(schedule, /const bool holdRecovery/);
  assert.match(
    schedule,
    /if \(!holdRecovery && staggerSlotIndex_ != scheduledIndex\)/,
  );
  assert.match(schedule, /Login is a presentation concern, not scheduler ownership/);
});

test('recovery has a bounded hold so one slow account cannot monopolize the viewport', () => {
  assert.match(schedule, /kSpotifySimpleRecoveryHoldMs = 12ULL \* 1000ULL/);
  assert.match(schedule, /const bool holdRecovery/);
  assert.match(schedule, /SlotStateNeedsRecovery\(current\.state\)/);
  assert.match(schedule, /if \(!holdRecovery && staggerSlotIndex_ != scheduledIndex\)/);
});

test('each scheduler ownership pass refreshes layout before returning for login', () => {
  assert.match(
    schedule,
    /Slot& slot = slots_\[staggerSlotIndex_\];[\s\S]*RefreshSpotifyHostLayout\(\);[\s\S]*if \(slot\.webview && SlotIsLoginPage\(slot\)\) return;/,
  );
});

test('the exact login slot participates in layout cache so auth handoff parks the old host', () => {
  assert.match(
    layout,
    /foregroundAuthenticationIndex[\s\S]*SlotIsLoginPage\(slots_\[i\]\)/,
  );
  assert.match(
    layout,
    /hostLayoutAuthenticationSlot_ == foregroundAuthenticationIndex[\s\S]*return;/,
  );
  assert.match(layout, /hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex/);
});
