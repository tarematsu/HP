import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const schedule = readFileSync(
  new URL('../../native/src/spotify_simple_schedule.inc', import.meta.url),
  'utf8',
);
const rotation = readFileSync(
  new URL('../../native/src/spotify_simple_rotation.inc', import.meta.url),
  'utf8',
);

test('runtime uses the simple scheduler instead of parallel background probing', () => {
  assert.match(wrapper, /#include "spotify_simple_rotation\.inc"/);
  assert.match(wrapper, /#include "spotify_simple_schedule\.inc"/);
  assert.doesNotMatch(wrapper, /spotify_timed_end_rotation\.inc/);
  assert.doesNotMatch(wrapper, /spotify_stagger_schedule\.inc/);
  assert.doesNotMatch(schedule, /BackgroundPlaybackProbe|playbackWatchdogIndex_/);
});

test('only one recovery-sized Spotify owner is selected at a time', () => {
  assert.match(schedule, /kSpotifyInitialSerialWindowMs = 6ULL \* 40ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifySimpleSteadyTurnMs = 15ULL \* 1000ULL/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed\)/);
  assert.match(schedule, /staggerSlotIndex_ = scheduledIndex/);
  assert.match(schedule, /holdRecovery/);
  assert.match(schedule, /kSpotifySimpleRecoveryHoldMs = 12ULL \* 1000ULL/);
});

test('slow responsive layout is allowed to settle before DOM recovery', () => {
  assert.match(schedule, /kSpotifySimpleLayoutSettleMs = 2ULL \* 1000ULL/);
  assert.match(
    schedule,
    /!slot\.playing[\s\S]*now - staggerSlotStartTick_ < kSpotifySimpleLayoutSettleMs[\s\S]*return;/,
  );
  assert.match(schedule, /kSpotifySimpleRetryMs = 4ULL \* 1000ULL/);
  assert.match(schedule, /ReconcileActiveTimedSlot\(slot\)/);
});

test('track completion is event driven with no permanent DOM polling loop', () => {
  assert.match(rotation, /media\.addEventListener\('ended'/);
  assert.match(rotation, /media\.addEventListener\('play'/);
  assert.doesNotMatch(rotation, /setInterval\(/);
  assert.match(rotation, /setTimeout\(state\.bind, 2000\)/);
  assert.match(rotation, /setTimeout\(state\.bind, 5000\)/);
  assert.match(rotation, /setTimeout\(state\.waitForNext, 2500\)/);
});

test('ambiguous ad or end state retries the same target instead of skipping it', () => {
  assert.match(rotation, /spotify:timed-waiting/);
  assert.match(schedule, /kSpotifySimplePendingRecoveryMs/);
  assert.match(schedule, /slot\.timedCompletionPendingTick = 0/);
  assert.match(schedule, /slot\.lastTimedReconcileTick = 0/);
  assert.doesNotMatch(
    schedule,
    /timedCompletionPendingTick[\s\S]*AdvanceTimedRotationSlot/,
  );
  assert.match(rotation, /AdvanceTimedRotationSlot\(\*target, now\)/);
});
