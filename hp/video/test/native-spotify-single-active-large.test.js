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

test('serialized Spotify shows authentication while every non-auth host stays 1x1', () => {
  assert.match(layout, /activeWidth = std::max\(1, clientWidth \* 3 \/ 5\)/);
  assert.match(layout, /activeHeight = std::max\(1, clientHeight \* 9 \/ 10\)/);
  assert.match(layout, /const size_t recoveryIndex =/);
  assert.match(layout, /hostLayoutActiveSlot_ == recoveryIndex/);
  assert.match(layout, /const bool authentication =/);
  assert.match(layout, /int width = 1;/);
  assert.match(layout, /int height = 1;/);
  assert.match(layout, /HWND insertAfter = HWND_BOTTOM;/);
  assert.match(layout, /if \(authentication\) \{[\s\S]*width = activeWidth;[\s\S]*height = activeHeight;[\s\S]*insertAfter = HWND_TOP;/);
});

test('background Spotify controllers stay visible while the host viewport is reduced', () => {
  assert.match(layout, /slot\.controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
  assert.doesNotMatch(layout, /kSpotifyParkedPlaybackWidth|kSpotifyLowPowerPlaybackWidth/);
});

test('trusted click recovery still accounts for controller zoom', () => {
  assert.match(layout, /kSpotifySerializedRecoveryZoom = 0\.80/);
  assert.match(click, /controller->get_ZoomFactor\(&controllerZoom\)/);
  assert.match(click, /cssWidth = static_cast<double>\(width\) \/ zoom/);
  assert.match(click, /Input\.dispatchMouseEvent/);
});

test('initial account starts are staggered and steady work uses one round-robin scan', () => {
  assert.match(header, /kSpotifyAccountStartOffsetMs = 60ULL \* 1000ULL/);
  assert.match(header, /PTP_TIMER schedulerTimer_ = nullptr/);
  assert.match(schedule, /const auto startupReady/);
  assert.match(schedule, /const size_t scanStart = \(schedulerCursor_ \+ 1\) % count/);
  assert.equal((schedule.match(/for \(size_t step = 0; step < count; \+\+step\)/g) || []).length, 1);
  assert.match(schedule, /healthyPlaybackNeedsNoWork\(candidate\)/);
  assert.match(phase, /kSpotifyHealthyAuditMs = 5U \* 60U \* 1000U/);
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
  assert.match(
    schedule,
    /schedulerCursor_ = selected;[\s\S]*Slot& slot = slots_\[selected\];[\s\S]*RefreshSpotifyHostLayout\(\);/,
  );
});

test('scheduler has one cursor and no obsolete ownership bookkeeping', () => {
  assert.match(header, /size_t schedulerCursor_ = 0/);
  assert.doesNotMatch(header, /staggerSlotIndex_|staggerSlotStartTick_|staggerSlotValidated_/);
});

test('the exact login slot participates in layout cache', () => {
  assert.match(layout, /foregroundAuthenticationIndex/);
  assert.match(layout, /hostLayoutAuthenticationSlot_ = foregroundAuthenticationIndex/);
});
