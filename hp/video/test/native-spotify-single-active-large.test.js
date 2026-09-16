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

test('Spotify keeps the same full-client surface for background and Monitor B/C/D runtime-lane inspection', () => {
  assert.match(layout, /const int hostX = client\.left;/);
  assert.match(layout, /const int hostY = client\.top;/);
  assert.match(layout, /client\.right - client\.left/);
  assert.match(layout, /client\.bottom - client\.top/);
  assert.match(layout, /const bool monitorForeground =\s*SpotifyRuntimeLaneForAccount\(i\) == monitorForegroundSlot_/);
  assert.match(layout, /monitorForeground \|\| authenticationForeground \? HWND_TOP : HWND_BOTTOM/);
  assert.match(layout, /const bool authentication =/);
  assert.doesNotMatch(layout, /kSpotifyBackgroundWidth|kSpotifyBackgroundHeight|ComputeMediaSurfaceAnchors|anchors\.air|CenterMediaSurfaceOnAnchor/);
  assert.doesNotMatch(layout, /compactPlayback|SpotifyMediaPanelRect/);
});

test('background Spotify controllers stay visible while z-order changes', () => {
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
  assert.doesNotMatch(layout, /kSpotifyParkedPlaybackWidth|kSpotifyLowPowerPlaybackWidth/);
});

test('trusted click recovery uses the verified CSS point without DPI or zoom reconstruction', () => {
  assert.doesNotMatch(layout, /kSpotifyRecoveryInteractionWidth|kSpotifyRecoveryInteractionHeight/);
  assert.match(click, /GetClientRect\(slot\.hostWindow, &hostClient\)/);
  assert.match(click, /const double x = cssX;/);
  assert.match(click, /const double y = cssY;/);
  assert.doesNotMatch(click, /controller->get_ZoomFactor|get_RasterizationScale|GetDpiForWindow|cssWidth|cssHeight/);
  assert.match(click, /Input\.dispatchMouseEvent/);
});

test('initial account starts are staggered and steady work uses one round-robin scan', () => {
  assert.match(header, /kSpotifyAccountStartOffsetMs = 10ULL \* 1000ULL/);
  assert.match(header, /PTP_TIMER schedulerTimer_ = nullptr/);
  assert.match(schedule, /const auto startupReady/);
  assert.match(schedule, /const size_t scanStart = \(schedulerCursor_ \+ 1\) % count/);
  assert.equal((schedule.match(/for \(size_t step = 0; step < count; \+\+step\)/g) || []).length, 1);
  assert.match(schedule, /healthyPlaybackNeedsNoWork\(candidate\)/);
  assert.match(phase, /kSpotifyHealthyAuditMs = 60U \* 60U \* 1000U/);
  assert.doesNotMatch(schedule, /SimpleSpotifyScheduledIndex|kSpotifySimpleSteadyTurnMs/);
});

test('authentication is skipped by the work queue without a scheduler lease', () => {
  assert.doesNotMatch(schedule, /kSpotifyAuthenticationHoldMs|holdAuthentication|holdRecovery/);
  assert.match(schedule, /SlotIsLoginPage\(candidate\)/);
});

test('recovery uses one five-second eligibility deadline', () => {
  assert.match(header, /ULONGLONG nextRecoveryTick = 0/);
  assert.match(phase, /kSpotifyRecoveryRetryMs = 5ULL \* 1000ULL/);
  assert.match(schedule, /const auto recoveryReady/);
  assert.match(schedule, /now >= slot\.nextRecoveryTick/);
  assert.doesNotMatch(header + phase + schedule, /lastTimedReconcileTick|kSpotifyQueueRetryMs|unhealthySinceTick/);
});

test('each serviced queue item refreshes layout once', () => {
  assert.equal((schedule.match(/RefreshSpotifyHostLayout\(\);/g) || []).length, 1);
  assert.match(schedule, /schedulerCursor_ = selected;[\s\S]*Slot& slot = slots_\[selected\];[\s\S]*RefreshSpotifyHostLayout\(\);/);
});

test('scheduler has one cursor and no obsolete ownership bookkeeping', () => {
  assert.match(header, /size_t schedulerCursor_ = 0/);
  assert.doesNotMatch(header, /staggerSlotIndex_|staggerSlotStartTick_|staggerSlotValidated_/);
});

test('the exact login slot participates in layout cache', () => {
  assert.match(layout, /foregroundAuthenticationIndex/);
  assert.match(layout, /hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex/);
});
