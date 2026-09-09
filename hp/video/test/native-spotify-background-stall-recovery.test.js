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
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url),
  'utf8',
);
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url),
  'utf8',
);
const heartbeat = readFileSync(
  new URL('../../native/src/spotify_media_observer_heartbeat.inc', import.meta.url),
  'utf8',
);
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);
const timed = readFileSync(
  new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url),
  'utf8',
);
const recent = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url),
  'utf8',
);

test('runtime uses one adaptive scheduler instead of parallel background probing', () => {
  assert.match(wrapper, /#include "spotify_stagger_schedule\.inc"/);
  assert.match(phase, /NextRobustSchedulerDelayMs/);
  assert.match(schedule, /owner->ArmRobustScheduler\(\)/);
  assert.doesNotMatch(schedule, /BackgroundPlaybackProbe|playbackWatchdogIndex_|RunPlaybackWatchdog/);
  assert.doesNotMatch(wrapper, /spotify_stagger_timer\.inc|#define SetTimer/);
});

test('only one recovery-sized Spotify owner is selected at a time', () => {
  assert.match(schedule, /accountCount \* kSpotifyTimedSlotOffsetMs/);
  assert.match(schedule, /kSpotifySimpleSteadyTurnMs = 20ULL \* 1000ULL/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed, slots_\.size\(\)\)/);
  assert.match(schedule, /staggerSlotIndex_ = scheduledIndex/);
  assert.match(schedule, /kSpotifySimpleRecoveryHoldMs = 36ULL \* 1000ULL/);
});

test('slow responsive layout settles before owner-only DOM recovery', () => {
  assert.match(schedule, /kSpotifySimpleLayoutSettleMs = 2ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifySimpleRetryMs = 4ULL \* 1000ULL/);
  assert.match(
    schedule,
    /SlotStateNeedsRecovery\(slot\.state\)[\s\S]*kSpotifySimpleLayoutSettleMs[\s\S]*return;/,
  );
  assert.match(schedule, /ReconcileActiveTimedSlot\(slot\)/);
});

test('track completion stays event driven while media progress has a low-frequency heartbeat', () => {
  assert.match(rotation, /kSpotifyFastEndObserverScript/);
  assert.match(events, /document\.addEventListener\('ended'/);
  assert.match(events, /document\.addEventListener\('play'/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.match(runtime, /spotify:generation/);
  assert.match(heartbeat, /setInterval\([\s\S]*10000\)/);
  assert.match(heartbeat, /heartbeatMisses >= 2/);
  assert.match(heartbeat, /currentTime > state\.heartbeatTime \+ 0\.05/);
  assert.match(heartbeat, /requestRecovery\(media\)/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
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
  assert.match(recent, /target->reconcileRequestGeneration != reconcileRequestGeneration/);
  assert.match(rotation, /observerTarget->timedObserverInstallGeneration !=[\s\S]*observerInstallGeneration/);
});

test('rotation hard deadline is armed before browser playback state is known', () => {
  assert.match(
    rotation,
    /ApplyTimedRotationTarget\(Slot& slot\)[\s\S]*slot\.timedPlaybackStartTick = GetTickCount64\(\)/,
  );
  assert.match(rotation, /kSpotifyTimedTrackDeadlineMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(
    phase,
    /slot\.timedPlaybackStartTick != 0[\s\S]*kSpotifyAdaptiveTrackDeadlineMs - age/,
  );
  assert.doesNotMatch(phase, /timedPlaybackStartTick = GetTickCount64\(\)/);
});

test('advertisements cannot complete or start a requested song', () => {
  assert.match(
    runtime,
    /!matchesTarget\(target, currentTrack\(\)\)[\s\S]*state\.started = false;[\s\S]*state\.targetMedia = null;/,
  );
  assert.match(
    events,
    /!state\.started \|\| state\.endedPosted[\s\S]*state\.targetMedia !== media/,
  );
  assert.match(runtime, /post\('spotify:timed-started'\)/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(\*target, now\)/);
});