import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url), 'utf8');
const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url), 'utf8');
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url), 'utf8');
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url), 'utf8');
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const timed = readFileSync(
  new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url), 'utf8');
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');

test('runtime uses one adaptive scheduler instead of parallel background probing', () => {
  assert.match(wrapper, /#include "spotify_stagger_schedule\.inc"/);
  assert.match(phase, /NextRobustSchedulerDelayMs/);
  assert.match(schedule, /owner->ArmRobustScheduler\(\)/);
  assert.doesNotMatch(schedule, /BackgroundPlaybackProbe|playbackWatchdogIndex_|RunPlaybackWatchdog/);
  assert.doesNotMatch(wrapper, /spotify_stagger_timer\.inc|#define SetTimer/);
});

test('only one recovery-sized Spotify owner is selected at a time', () => {
  assert.match(header, /kSpotifyAccountStartOffsetMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /static_cast<ULONGLONG>\(accountCount\) \* kSpotifyAccountStartOffsetMs/);
  assert.match(schedule, /kSpotifySimpleSteadyTurnMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed, slots_\.size\(\)\)/);
  assert.match(schedule, /staggerSlotIndex_ = scheduledIndex/);
  assert.match(schedule, /kSpotifySimpleRecoveryHoldMs = 36ULL \* 1000ULL/);
});

test('slow responsive layout settles before owner-only DOM reconciliation', () => {
  assert.match(schedule, /kSpotifySimpleLayoutSettleMs = 2ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifySimpleRetryMs = 4ULL \* 1000ULL/);
  assert.match(
    schedule,
    /SlotStateNeedsRecovery\(slot\.state\)[\s\S]*kSpotifySimpleLayoutSettleMs[\s\S]*return;/,
  );
  assert.match(schedule, /ReconcileActiveTimedSlot\(slot\)/);
});

test('track completion is native-timer driven with no media heartbeat', () => {
  assert.match(rotation, /kSpotifyFastEndObserverScript/);
  assert.match(events, /document\.addEventListener\('play'/);
  assert.match(events, /document\.addEventListener\('playing'/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(runtime, /spotify:generation/);
  assert.doesNotMatch(wrapper, /spotify_media_observer_heartbeat\.inc/);
  assert.doesNotMatch(runtime + events, /heartbeatTimer|heartbeatMisses|requestRecovery/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.match(rotation, /timedCompletionDeadlineTick = now \+ remainingMs/);
});

test('lost ExecuteScript callbacks expire instead of wedging a slot forever', () => {
  assert.match(header, /ULONGLONG reconcileRequestGeneration = 0/);
  assert.match(header, /ULONGLONG reconcileStartedTick = 0/);
  assert.match(header, /ULONGLONG timedObserverInstallGeneration = 0/);
  assert.match(header, /ULONGLONG timedObserverInstallStartedTick = 0/);
  assert.match(phase, /kSpotifyAsyncOperationTimeoutMs = 12ULL \* 1000ULL/);
  assert.match(phase, /ExpireStaleAsyncWork\(\s*Slot& slot, ULONGLONG now\)/);
  assert.match(schedule, /ExpireStaleAsyncWork\(candidate, now\)/);
  assert.match(timed, /target->reconcileRequestGeneration != reconcileRequestGeneration/);
  assert.match(music, /target->reconcileRequestGeneration != reconcileRequestGeneration/);
  assert.match(rotation, /observerTarget->timedObserverInstallGeneration !=[\s\S]*observerInstallGeneration/);
});

test('playback anomalies cannot postpone the native completion deadline', () => {
  assert.doesNotMatch(header, /kSpotifyMusicTrackDeadlineMs/);
  assert.doesNotMatch(runtime + events + rotation, /spotify:not-playing/);
  assert.doesNotMatch(runtime + events, /requestRecovery|scheduleRecovery/);
  assert.match(rotation, /timedCompletionDeadlineTick == 0/);
  assert.match(rotation, /timedCompletionDeadlineGeneration != eventGeneration/);
  assert.doesNotMatch(rotation, /timed-plan-clear|candidateDeadline/);
  assert.doesNotMatch(events, /addEventListener\('ended'|addEventListener\('timeupdate'/);
});

test('advertisements cannot start the requested-song timer', () => {
  assert.match(runtime, /const enforceTarget = media =>/);
  assert.match(runtime, /else if \(!matchesTarget\(target, identity\)\)/);
  assert.match(runtime, /if \(!state\.startPosted\) return 'unknown'/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(slot, now\)/);
});
