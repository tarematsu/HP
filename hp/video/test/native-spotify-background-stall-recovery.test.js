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
const observer = readFileSync(
  new URL('../../native/src/spotify_fast_end_observer.inc', import.meta.url),
  'utf8',
);
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
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
  assert.match(schedule, /kSpotifyInitialSerialWindowMs = 6ULL \* 40ULL \* 1000ULL/);
  assert.match(schedule, /kSpotifySimpleSteadyTurnMs = 20ULL \* 1000ULL/);
  assert.match(schedule, /SimpleSpotifyScheduledIndex\(elapsed\)/);
  assert.match(schedule, /staggerSlotIndex_ = scheduledIndex/);
  assert.match(schedule, /kSpotifySimpleRecoveryHoldMs = 12ULL \* 1000ULL/);
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

test('track completion is event driven from one generation-aware observer script', () => {
  assert.match(rotation, /kSpotifyFastEndObserverScript/);
  assert.match(observer, /__homePanelSpotifyMediaObserverInstalled/);
  assert.match(observer, /document\.addEventListener\('ended'/);
  assert.match(observer, /document\.addEventListener\('play'/);
  assert.match(observer, /post\('spotify:timed-ended'\)/);
  assert.match(observer, /spotify:generation/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.doesNotMatch(observer, /setInterval\(/);
  assert.doesNotMatch(rotation, /BuildSpotify.*ObserverScript|std::wstring script/);
});

test('current-track identity is scoped to player UI before MediaSession fallback', () => {
  assert.match(observer, /\[data-testid="now-playing-widget"\] a\[href\*="\/track\/"\]/);
  assert.match(observer, /\[data-testid="now-playing-bar"\] \[data-testid="context-item-link"\]/);
  assert.match(observer, /footer \[data-testid="context-item-link"\]/);
  assert.doesNotMatch(
    observer,
    /^\s*'\[data-testid="context-item-link"\]\[href\*="\/track\/"\]'\s*$/m,
  );
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
  assert.doesNotMatch(rotation, /timedPlaybackStartTick == 0[\s\S]*timedPlaybackStartTick = now/);
});

test('advertisements cannot complete or start a requested song', () => {
  assert.match(
    observer,
    /!matchesTarget\(target, currentTrack\(\)\)[\s\S]*state\.started = false;[\s\S]*state\.targetMedia = null;/,
  );
  assert.match(
    observer,
    /!state\.started \|\| state\.endedPosted[\s\S]*state\.targetMedia !== media/,
  );
  assert.match(observer, /post\('spotify:timed-started'\)/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(\*target, now\)/);
});
