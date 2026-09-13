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
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');

test('runtime uses one adaptive threadpool scheduler instead of parallel probing', () => {
  assert.match(wrapper, /#include "spotify_stagger_schedule\.inc"/);
  assert.match(phase, /NextRobustSchedulerDelayMs/);
  assert.match(phase, /SchedulerTimerProc/);
  assert.match(header, /PTP_TIMER schedulerTimer_ = nullptr/);
  assert.doesNotMatch(schedule, /BackgroundPlaybackProbe|playbackWatchdogIndex_|RunPlaybackWatchdog/);
  assert.doesNotMatch(phase + schedule, /::SetTimer\(|KillTimer\(|StaggeredReconcileTimerProc/);
  assert.doesNotMatch(wrapper, /spotify_stagger_timer\.inc|#define SetTimer/);
});

test('slot state is the recovery queue with no fixed ownership lease', () => {
  assert.match(header, /kSpotifyAccountStartOffsetMs = 10ULL \* 1000ULL/);
  assert.match(phase, /kSpotifyQueueRetryMs = 4ULL \* 1000ULL/);
  assert.match(schedule, /const size_t scanStart = \(schedulerCursor_ \+ 1\) % count/);
  assert.match(schedule, /candidate\.state != SlotState::Recovering/);
  assert.match(schedule, /!candidate\.timedRotationActive \|\|\s*SlotStateNeedsRecovery\(candidate\.state\)/);
  assert.doesNotMatch(schedule, /kSpotifySimpleRecoveryHoldMs|holdRecovery|SimpleSpotifyScheduledIndex/);
});

test('queue runs at most one music reconciliation per scheduler pass', () => {
  const reconciles = schedule.match(/ReconcileMusicTarget\(slot\);/g) || [];
  assert.equal(reconciles.length, 1);
  assert.match(schedule, /selected = index;\s*break;/);
  assert.match(schedule, /schedulerCursor_ = selected/);
  assert.match(schedule, /RefreshSpotifyHostLayout\(\)/);
  assert.match(schedule, /const auto asyncIdle/);
});

test('slow recovery wakes at its next real four-second retry instead of polling every two seconds', () => {
  assert.match(phase, /kSpotifyQueueRetryMs = 4ULL \* 1000ULL/);
  assert.match(phase, /slot\.lastTimedReconcileTick \+ kSpotifyQueueRetryMs/);
  assert.match(
    schedule,
    /lastTimedReconcileTick == 0 \|\|\s*now - slot\.lastTimedReconcileTick >= kSpotifyQueueRetryMs/,
  );
  assert.match(schedule, /ReconcileMusicTarget\(slot\)/);
  assert.match(phase, /kSpotifySchedulerBootstrapMs = 2U \* 1000U/);
});

test('track completion remains native-deadline driven with no media heartbeat', () => {
  assert.match(rotation, /kSpotifyFastEndObserverScript/);
  assert.match(events, /document\.addEventListener\('play'/);
  assert.match(events, /document\.addEventListener\('playing'/);
  assert.match(events, /document\.addEventListener\('ended'/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.doesNotMatch(wrapper, /spotify_media_observer_heartbeat\.inc/);
  assert.doesNotMatch(runtime + events, /heartbeatTimer|heartbeatMisses|requestRecovery/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd/);

  const endedStart = rotation.indexOf('if (ended) {');
  const endedEnd = rotation.indexOf('SetSlotState(*target, SlotState::Playing)', endedStart);
  assert.ok(endedStart >= 0 && endedEnd > endedStart);
  assert.doesNotMatch(rotation.slice(endedStart, endedEnd), /AdvanceTimedRotationSlot/);
});

test('lost ExecuteScript callbacks expire instead of wedging a slot forever', () => {
  assert.match(header, /ULONGLONG reconcileRequestGeneration = 0/);
  assert.match(header, /ULONGLONG reconcileStartedTick = 0/);
  assert.match(header, /ULONGLONG timedObserverInstallGeneration = 0/);
  assert.match(header, /ULONGLONG timedObserverInstallStartedTick = 0/);
  assert.match(phase, /kSpotifyAsyncOperationTimeoutMs = 12ULL \* 1000ULL/);
  assert.match(phase, /ExpireStaleAsyncWork\(\s*Slot& slot, ULONGLONG now\)/);
  assert.match(schedule, /ExpireStaleAsyncWork\(candidate, now\)/);
  assert.doesNotMatch(phase, /staggerSlotIndex_|staggerSlotStartTick_|staggerSlotValidated_/);
  assert.match(music, /target->reconcileRequestGeneration != reconcileRequestGeneration/);
  assert.match(rotation, /observerTarget->timedObserverInstallGeneration !=[\s\S]*observerInstallGeneration/);
});

test('playback anomalies cannot postpone the native completion deadline', () => {
  assert.doesNotMatch(header, /kSpotifyMusicTrackDeadlineMs/);
  assert.doesNotMatch(runtime + events + rotation, /spotify:not-playing/);
  assert.doesNotMatch(runtime + events, /requestRecovery|scheduleRecovery/);
  assert.match(music, /timedCompletionDeadlineTick != 0/);
  assert.match(music, /timedCompletionDeadlineGeneration == slot\.targetGeneration/);
  assert.doesNotMatch(rotation, /timed-plan-clear|candidateDeadline/);
  assert.doesNotMatch(events, /addEventListener\('timeupdate'/);
  assert.match(music, /timedCompletionDeadlineTick > endedTick/);
});

test('advertisements cannot start or falsely end the requested-song timer', () => {
  assert.match(runtime, /const enforceTarget = media =>/);
  assert.match(runtime, /else if \(!matchesTarget\(target, identity\)\)/);
  assert.match(runtime, /if \(!state\.startPosted\) return 'unknown'/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(events, /state\.interruptionStartedAt/);
  assert.match(events, /state\.targetMedia !== media/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(slot\)/);
});
