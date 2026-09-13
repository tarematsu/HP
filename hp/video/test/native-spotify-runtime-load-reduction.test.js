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

test('timed music observer installs no periodic completion probe', () => {
  assert.match(events, /document\.addEventListener\('play'/);
  assert.match(events, /document\.addEventListener\('playing'/);
  assert.match(events, /document\.addEventListener\('loadedmetadata'/);
  assert.match(events, /document\.addEventListener\('durationchange'/);
  assert.match(events, /document\.addEventListener\('ended', observeEnded, true\)/);
  assert.doesNotMatch(
    events,
    /addEventListener\('(?:timeupdate|seeking|seeked|waiting|stalled|pause)'/,
  );
  assert.doesNotMatch(events, /setInterval|MutationObserver/);
  assert.match(runtime, /const enforceTarget = media =>/);
});

test('timed music observer contains no playback recovery heartbeat or completion loop', () => {
  assert.doesNotMatch(runtime, /requestRecovery|scheduleRecovery|recoveryPosted|restartPending/);
  assert.doesNotMatch(runtime, /heartbeatTimer|heartbeatMisses|startHeartbeat|stopHeartbeat/);
  assert.doesNotMatch(runtime, /spotify:not-playing|postCompletionPlan|clearCompletionPlan|probeCompletion/);
  assert.doesNotMatch(events, /scheduleRecovery|requestRecovery|spotify:not-playing/);
  assert.doesNotMatch(events, /setInterval|startHeartbeat|stopHeartbeat|quarantineCompletedGeneration/);
  assert.doesNotMatch(bundle, /kSpotifyMediaObserverHeartbeatScript|kSpotifyMediaObserverCompletionScript/);
});

test('ended listener is event-driven and only emits an advisory deadline-shortening signal', () => {
  assert.match(events, /const observeEnded = event =>/);
  assert.match(events, /state\.targetMedia !== media/);
  assert.match(events, /state\.interruptionStartedAt/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.doesNotMatch(events, /setTimeout\([^)]*ended|setInterval/);
});

test('healthy native Spotify sleeps up to five minutes and wakes at exact pending work', () => {
  assert.match(phase, /kSpotifyHealthyAuditMs = 5U \* 60U \* 1000U/);
  assert.match(phase, /kSpotifySchedulerBootstrapMs = 2U \* 1000U/);
  assert.match(phase, /kSpotifyQueueRetryMs = 4ULL \* 1000ULL/);
  assert.match(phase, /slot\.lastTimedReconcileTick \+ kSpotifyQueueRetryMs/);
  assert.match(phase, /slot\.reconcileStartedTick \+ kSpotifyAsyncOperationTimeoutMs/);
  assert.match(phase, /considerTick\(boundary\)/);
  assert.doesNotMatch(phase, /::SetTimer\(|KillTimer\(/);
});

test('healthy deadline-owned playback does not enter DOM reconcile work', () => {
  assert.match(schedule, /const auto healthyPlaybackNeedsNoWork/);
  assert.match(schedule, /SlotStateIsHealthy\(slot\.state\)/);
  assert.match(schedule, /slot\.timedObserverReady/);
  assert.match(schedule, /slot\.timedCompletionDeadlineGeneration == slot\.targetGeneration/);
  assert.match(schedule, /healthyPlaybackNeedsNoWork\(candidate\)/);
  assert.ok(
    schedule.indexOf('healthyPlaybackNeedsNoWork(candidate)') <
      schedule.indexOf('ReconcileMusicTarget(slot)'),
  );
});
