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
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url),
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
  assert.match(header, /kSpotifyAccountStartOffsetMs = 40ULL \* 1000ULL/);
  assert.match(schedule, /static_cast<ULONGLONG>\(accountCount\) \* kSpotifyAccountStartOffsetMs/);
  assert.match(schedule, /kSpotifySimpleSteadyTurnMs = 40ULL \* 1000ULL/);
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
  assert.match(heartbeat, /setInterval\([\s\S]*20000\)/);
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
  assert.match(music, /target->reconcileRequestGeneration != reconcileRequestGeneration/);
  assert.match(rotation, /observerTarget->timedObserverInstallGeneration !=[\s\S]*observerInstallGeneration/);
});

test('playback anomalies fail forward to the next track instead of retrying the same target', () => {
  assert.doesNotMatch(header, /kSpotifyMusicTrackDeadlineMs/);
  assert.doesNotMatch(phase + schedule + rotation, /AdvanceExpiredTimedRotation|kSpotifyMusicTrackDeadlineMs/);
  assert.match(runtime, /post\('spotify:not-playing'\)/);
  assert.match(rotation, /const bool stopped =[\s\S]*spotify:not-playing/);
  assert.doesNotMatch(rotation, /if \(stopped\)[\s\S]{0,500}MarkSlotRecovering\(\*target, now\)/);
  assert.match(rotation, /Playback anomalies are fail-forward events[\s\S]*AdvanceTimedRotationSlot\(\*target, now\)/);
  assert.doesNotMatch(events, /finishLeadSeconds|duration - finishLeadSeconds/);
  assert.match(events, /document\.addEventListener\('ended'/);
});

test('advertisements cannot complete or start a requested song', () => {
  assert.match(runtime, /const enforceTarget = media =>/);
  assert.match(
    runtime,
    /const identity = currentTrack\(\);[\s\S]*!matchesTarget\(target, identity\)[\s\S]*state\.started = false;[\s\S]*state\.targetMedia = null;/,
  );
  assert.match(
    events,
    /!state\.started \|\| state\.endedPosted[\s\S]*state\.targetMedia !== media/,
  );
  assert.match(runtime, /post\('spotify:timed-started'\)/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(\*target, now\)/);
});
