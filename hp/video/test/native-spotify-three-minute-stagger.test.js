import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);
const timer = readFileSync(
  new URL('../../native/src/spotify_stagger_timer.inc', import.meta.url),
  'utf8',
);
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url),
  'utf8',
);

test('Spotify startup and fallback mode timers are effectively staggered by three minutes', () => {
  assert.match(wrapper, /#include "spotify_stagger_timer\.inc"/);
  assert.match(wrapper, /#define SetTimer\(hwnd, timerId, interval, callback\)/);
  assert.match(timer, /kSpotifySerializedSlotStepMs = 3U \* 60U \* 1000U/);
  assert.match(timer, /kSpotifyLegacyStartupTimerId = 1/);
  assert.match(timer, /kSpotifyLegacyModeSwitchTimerId = 3/);
  assert.match(timer, /interval \/ kSpotifyLegacyStartupStepMs/);
  assert.match(timer, /interval \/ kSpotifyLegacyModeSwitchStepMs/);
});

test('robust Spotify scheduler processes only one slot for each three-minute ownership window', () => {
  assert.match(header, /StaggeredReconcileTimerProc/);
  assert.match(header, /staggerSlotIndex_ = 0/);
  assert.match(header, /staggerSlotStartTick_ = 0/);
  assert.match(timer, /kSpotifyRobustTimerId = 0x53505243/);
  assert.match(timer, /StaggeredReconcileTimerProc/);
  assert.match(schedule, /kSpotifySerializedSlotHoldMs =\s*3ULL \* 60ULL \* 1000ULL/);
  assert.match(schedule, /Slot& slot = slots_\[staggerSlotIndex_\]/);
  assert.match(schedule, /reconcileIndex_ = staggerSlotIndex_/);
  assert.match(schedule, /staggerSlotIndex_ = \(staggerSlotIndex_ \+ 1\) % slots_\.size\(\)/);
  assert.match(schedule, /holdElapsed/);
});

test('mode changes do not clear or navigate all six Spotify WebViews together', () => {
  assert.match(wrapper, /#define SetPodcastMode SetPodcastModeImmediate/);
  assert.match(wrapper, /#include "spotify_stagger_schedule\.inc"/);
  assert.match(schedule, /void SpotifyWebViews::SetPodcastMode\(bool podcastWindowActive\) noexcept/);
  assert.match(schedule, /if \(!slots_\[i\]\.webview\) slots_\[i\]\.playing = true/);
  assert.match(schedule, /staggerSlotIndex_ = 0/);
  assert.doesNotMatch(
    schedule,
    /for \(Slot& slot : slots_\) \{[\s\S]*slot\.webview->Navigate/,
  );
  assert.doesNotMatch(schedule, /kSpotifyClearLegacyEnsureScript/);
});
