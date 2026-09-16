import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const events = source('spotify_media_observer_events.inc');
const bundle = source('spotify_fast_end_observer.inc');
const phase = source('spotify_phase_sync.inc');
const schedule = source('spotify_stagger_schedule.inc');

test('music observer is event driven with no periodic completion probe', () => {
  assert.match(events, /document\.addEventListener\('playing'/);
  assert.match(events, /document\.addEventListener\('durationchange'/);
  assert.match(events, /document\.addEventListener\('loadedmetadata'/);
  assert.match(events, /document\.addEventListener\('canplay'/);
  assert.match(events, /document\.addEventListener\('timeupdate'/);
  assert.match(events, /document\.addEventListener\('ended', observeEnded, true\)/);
  assert.doesNotMatch(events, /document\.addEventListener\('play'/);
  assert.doesNotMatch(events, /setInterval|setTimeout|MutationObserver/);
  assert.match(runtime, /const enforceTarget = media =>/);
});

test('observer contains no playback heartbeat or parallel recovery loop', () => {
  assert.doesNotMatch(runtime, /requestRecovery|scheduleRecovery|recoveryPosted|restartPending/);
  assert.doesNotMatch(runtime, /heartbeatTimer|heartbeatMisses|startHeartbeat|stopHeartbeat/);
  assert.doesNotMatch(runtime, /spotify:not-playing|postCompletionPlan|clearCompletionPlan|probeCompletion/);
  assert.doesNotMatch(events, /scheduleRecovery|requestRecovery|spotify:not-playing/);
  assert.doesNotMatch(bundle, /kSpotifyMediaObserverHeartbeatScript|kSpotifyMediaObserverCompletionScript/);
});

test('ended remains only an advisory native-deadline shortening signal', () => {
  assert.match(events, /const observeEnded = event =>/);
  assert.match(events, /state\.targetMedia !== media/);
  assert.match(events, /state\.interrupted/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
});

test('healthy Spotify uses exact playback deadlines with only an hourly safety audit', () => {
  assert.match(phase, /kSpotifyHealthyAuditMs = 60U \* 60U \* 1000U/);
  assert.match(phase, /kSpotifySchedulerBootstrapMs = 2U \* 1000U/);
  assert.match(phase, /kSpotifyRecoveryRetryMs = 5ULL \* 1000ULL/);
  assert.match(phase, /considerTick\(slot\.timedCompletionDeadlineTick\)/);
  assert.match(phase, /considerTick\(slot\.nextRecoveryTick\)/);
  assert.match(phase, /slot\.asyncStartedTick \+ kSpotifyAsyncOperationTimeoutMs/);
  assert.match(phase, /considerTick\(boundary\)/);
  assert.doesNotMatch(phase, /kSpotifyQueueRetryMs|lastTimedReconcileTick|::SetTimer\(|KillTimer\(/);
});

test('healthy deadline-owned playback does not enter DOM reconcile work', () => {
  assert.match(schedule, /const auto healthyPlaybackNeedsNoWork/);
  assert.match(schedule, /SlotStateIsHealthy\(slot\.state\)/);
  assert.doesNotMatch(schedule, /slot\.timedObserverReady/);
  assert.match(schedule, /slot\.timedCompletionDeadlineGeneration == slot\.targetGeneration/);
  assert.match(schedule, /healthyPlaybackNeedsNoWork\(candidate\)/);
  assert.ok(
    schedule.indexOf('healthyPlaybackNeedsNoWork(candidate)') <
      schedule.indexOf('ReconcileMusicTarget(slot)'),
  );
});
