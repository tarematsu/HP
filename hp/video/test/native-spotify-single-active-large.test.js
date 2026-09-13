import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(
  new URL('../../native/src/spotify_host_layout.inc', import.meta.url),
  'utf8',
);
const click = readFileSync(
  new URL('../../native/src/spotify_background_click.inc', import.meta.url),
  'utf8',
);
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
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
  assert.match(layout, /activeWidth = std::max\(1, clientWidth \* 3 \/ 5\)/);
  assert.match(layout, /activeHeight = std::max\(1, clientHeight \* 9 \/ 10\)/);
  assert.match(layout, /const size_t recoveryIndex =/);
  assert.match(layout, /hostLayoutActiveSlot_ == recoveryIndex/);
  assert.match(
    layout,
    /const bool authentication =\s*i == hostLayoutAuthenticationSlot_ && SlotIsLoginPage\(slot\)/,
  );
  assert.match(
    layout,
    /const bool recovery =\s*i == hostLayoutActiveSlot_ && !authentication &&\s*SlotStateNeedsRecovery\(slot\.state\)/,
  );
  assert.match(layout, /x = client\.right \+ 32/);
  assert.match(header, /hostLayoutAuthenticationSlot_ = kAccountCount/);
});

test('inactive Spotify playback hosts retain a small nonzero viewport', () => {
  assert.match(layout, /kSpotifyParkedPlaybackWidth = 160/);
  assert.match(layout, /kSpotifyParkedPlaybackHeight = 90/);
  assert.match(layout, /static_cast<int>\(i\) \*[\s\S]*kSpotifyParkedPlaybackWidth \+ kSpotifyParkedPlaybackGap/);
  assert.doesNotMatch(layout, /int width = 1;\s*int height = 1/);
});

test('recovery interaction never depends on the compact Spotify breakpoint', () => {
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
  assert.match(layout, /kSpotifySerializedRecoveryZoom = 0\.80/);
});

test('reduced Spotify zoom is changed only when the layout mode changes', () => {
  assert.match(header, /bool hostLayoutReducedZoomApplied = false/);
  assert.match(layout, /const bool reducedZoom = authentication \|\| recovery/);
  assert.match(layout, /hostLayoutReducedZoomApplied != reducedZoom/);
  assert.match(
    layout,
    /put_ZoomFactor\(\s*reducedZoom \? kSpotifySerializedRecoveryZoom : 1\.0\)/,
  );
  assert.doesNotMatch(layout, /get_ZoomFactor\(/);
});

test('trusted CDP clicks compensate for WebView2 zoom before dispatch', () => {
  assert.match(click, /controller->get_ZoomFactor\(&controllerZoom\)/);
  assert.match(click, /cssWidth = static_cast<double>\(width\) \/ zoom/);
  assert.match(click, /cssHeight = static_cast<double>\(height\) \/ zoom/);
  assert.match(click, /Input\.dispatchMouseEvent/);
});

test('initial account starts are ten seconds apart and steady work is state driven', () => {
  assert.match(header, /kSpotifyAccountStartOffsetMs = 10ULL \* 1000ULL/);
  assert.match(header, /PTP_TIMER schedulerTimer_ = nullptr/);
  assert.match(schedule, /const auto startupReady/);
  assert.match(schedule, /SlotState is the queue/);
  assert.match(schedule, /No work is queued:[\s\S]*60-second healthy scheduler wake/);
  assert.doesNotMatch(schedule, /SimpleSpotifyScheduledIndex|kSpotifySimpleSteadyTurnMs/);
});

test('authentication never owns or extends a scheduler lease', () => {
  assert.doesNotMatch(schedule, /kSpotifyAuthenticationHoldMs|holdAuthentication|holdRecovery/);
  assert.match(schedule, /SlotIsLoginPage\(candidate\)/);
  assert.match(schedule, /if \(slot\.webview && SlotIsLoginPage\(slot\)\) return/);
});

test('recovery is reselected by state at the exact retry deadline instead of a fixed hold', () => {
  assert.match(schedule, /candidate\.state != SlotState::Recovering/);
  assert.match(phase, /kSpotifyQueueRetryMs = 4ULL \* 1000ULL/);
  assert.match(phase, /slot\.lastTimedReconcileTick \+ kSpotifyQueueRetryMs/);
  assert.doesNotMatch(schedule, /kSpotifySimpleRecoveryHoldMs|staggerSlotStartTick_ < /);
});

test('each serviced queue item refreshes layout before returning for login', () => {
  assert.match(
    schedule,
    /schedulerCursor_ = selected;[\s\S]*Slot& slot = slots_\[selected\];[\s\S]*RefreshSpotifyHostLayout\(\);[\s\S]*if \(slot\.webview && SlotIsLoginPage\(slot\)\) return;/,
  );
});

test('scheduler has one cursor and no obsolete ownership bookkeeping', () => {
  assert.match(header, /size_t schedulerCursor_ = 0/);
  assert.doesNotMatch(header, /staggerSlotIndex_|staggerSlotStartTick_|staggerSlotValidated_/);
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
