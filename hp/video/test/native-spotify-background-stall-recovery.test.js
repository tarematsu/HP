import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url),
  'utf8',
);
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url),
  'utf8',
);
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);

test('runtime uses one simple scheduler instead of parallel background probing', () => {
  assert.match(wrapper, /#include "spotify_stagger_schedule\.inc"/);
  assert.match(schedule, /There is no second background watchdog/);
  assert.doesNotMatch(schedule, /BackgroundPlaybackProbe|playbackWatchdogIndex_|RunPlaybackWatchdog/);
  assert.doesNotMatch(wrapper, /spotify_stagger_timer\.inc|#define SetTimer/);
});

test('only one recovery-sized Spotify owner is selected at a time', () => {
  assert.match(schedule, /kSpotifyInitialSerialWindowMs = 6ULL \* 40ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifySimpleSteadyTurnMs = 15ULL \* 1000ULL/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed\)/);
  assert.match(schedule, /staggerSlotIndex_ = scheduledIndex/);
  assert.match(schedule, /kSpotifySimpleRecoveryHoldMs = 12ULL \* 1000ULL/);
});

test('slow responsive layout settles before owner-only DOM recovery', () => {
  assert.match(schedule, /kSpotifySimpleLayoutSettleMs = 2ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifySimpleRetryMs = 4ULL \* 1000ULL/);
  assert.match(
    schedule,
    /!slot\.playing[\s\S]*kSpotifySimpleLayoutSettleMs[\s\S]*return;/,
  );
  assert.match(schedule, /ReconcileActiveTimedSlot\(slot\)/);
});

test('track completion is event driven from one fixed observer script', () => {
  assert.match(rotation, /kSpotifyStaticEndObserverScript/);
  assert.match(scripts, /kSpotifyStaticEndObserverScript\[\]/);
  assert.match(scripts, /media\.addEventListener\('ended'/);
  assert.match(scripts, /media\.addEventListener\('play'/);
  assert.match(scripts, /setTimeout\(state\.waitForNext, 2500\)/);
  assert.doesNotMatch(scripts, /setInterval\(/);
  assert.doesNotMatch(rotation, /BuildSpotify.*ObserverScript|std::wstring script/);
});

test('ambiguous ad or end state retries the same target instead of skipping it', () => {
  assert.match(scripts, /spotify:timed-waiting/);
  assert.match(rotation, /spotify:timed-waiting/);
  assert.match(schedule, /kSpotifySimplePendingRecoveryMs/);
  assert.match(schedule, /slot\.timedCompletionPendingTick = 0/);
  assert.match(schedule, /slot\.lastTimedReconcileTick = 0/);
  assert.doesNotMatch(schedule, /timedCompletionPendingTick[\s\S]*AdvanceTimedRotationSlot/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(\*target, now\)/);
});
