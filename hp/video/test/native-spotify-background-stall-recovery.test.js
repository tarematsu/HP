import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const wrapper = source('spotify_webviews.inc');
const schedule = source('spotify_stagger_schedule.inc');
const rotation = source('spotify_timed_end_rotation.inc');
const runtime = source('spotify_media_observer_runtime.inc');
const events = source('spotify_media_observer_events.inc');
const phase = source('spotify_phase_sync.inc');
const header = source('spotify_webviews.h');
const music = source('spotify_music_target.inc');

test('runtime uses one adaptive scheduler instead of parallel probing', () => {
  assert.match(wrapper, /#include "spotify_stagger_schedule\.inc"/);
  assert.match(phase, /NextRobustSchedulerDelayMs/);
  assert.match(phase, /SchedulerTimerProc/);
  assert.match(header, /PTP_TIMER schedulerTimer_ = nullptr/);
  assert.doesNotMatch(schedule, /BackgroundPlaybackProbe|RunPlaybackWatchdog/);
  assert.doesNotMatch(phase + schedule, /::SetTimer\(|KillTimer\(|StaggeredReconcileTimerProc/);
});

test('slot state is the recovery queue with one retry deadline', () => {
  assert.match(header, /ULONGLONG nextRecoveryTick = 0/);
  assert.match(phase, /kSpotifyRecoveryRetryMs = 5ULL \* 1000ULL/);
  assert.match(phase, /slot\.nextRecoveryTick = now \+ kSpotifyRecoveryRetryMs/);
  assert.match(schedule, /const auto recoveryReady/);
  assert.match(schedule, /now >= slot\.nextRecoveryTick/);
  assert.doesNotMatch(header + phase, /lastModeNavigateTick|lastTimedReconcileTick|unhealthySinceTick/);
});

test('queue scans once and runs at most one music reconciliation per pass', () => {
  const reconciles = schedule.match(/ReconcileMusicTarget\(slot\);/g) || [];
  assert.equal(reconciles.length, 1);
  assert.equal((schedule.match(/for \(size_t step = 0; step < count; \+\+step\)/g) || []).length, 1);
  assert.match(schedule, /selected = index;\s*break;/);
  assert.match(schedule, /schedulerCursor_ = selected/);
});

test('lost scheduler-owned async work uses one epoch and EcoQoS-tolerant timeout', () => {
  assert.match(header, /enum class AsyncWork/);
  assert.match(header, /ULONGLONG asyncEpoch = 0/);
  assert.match(header, /ULONGLONG asyncStartedTick = 0/);
  assert.match(header, /AsyncWork asyncWork = AsyncWork::None/);
  assert.match(phase, /kSpotifyAsyncOperationTimeoutMs = 30ULL \* 1000ULL/);
  assert.match(phase, /ExpireStaleAsyncWork/);
  assert.match(music, /target->asyncEpoch != asyncEpoch/);
  assert.match(rotation, /observerTarget->asyncEpoch != asyncEpoch/);
  assert.doesNotMatch(header, /reconcileRequestGeneration|timedObserverInstallGeneration|reconcileInFlight|timedObserverInstallInFlight/);
});

test('track completion remains native-deadline driven with no heartbeat', () => {
  assert.match(events, /document\.addEventListener\('playing'/);
  assert.match(events, /document\.addEventListener\('ended'/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.doesNotMatch(wrapper, /spotify_media_observer_heartbeat\.inc/);
  assert.doesNotMatch(runtime + events, /heartbeatTimer|heartbeatMisses|requestRecovery/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd/);
});

test('non-target playback resumes by replacing the deadline from remaining duration', () => {
  assert.match(runtime, /state\.interrupted = true/);
  assert.match(runtime, /spotify:timed-resumed/);
  assert.match(rotation, /ParseSpotifyResumedEvent/);
  assert.match(rotation, /SetMusicCompletionDeadline\([\s\S]*remainingMs, resumed/);
  assert.doesNotMatch(header + phase + rotation, /timedInterruptionStartTick|SpotifyDeadlineWithInterruptionHold|kSpotifyMaxInterruptionHoldMs/);
});
