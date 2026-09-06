import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schedule = readFileSync(
  new URL('../../native/src/spotify_stagger_schedule.inc', import.meta.url),
  'utf8',
);
const ended = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);

test('all six active Spotify windows get a lightweight serialized stall probe', () => {
  assert.match(schedule, /kSpotifyBackgroundPlaybackProbeScript/);
  assert.match(schedule, /playbackWatchdogIndex_\+\+ % slots_\.size\(\)/);
  assert.match(schedule, /__homePanelSpotifyBackgroundProbe/);
  assert.match(schedule, /Math\.abs\(currentTime - state\.time\) < 0\.25/);
  assert.match(schedule, /return 'stalled'/);
  assert.match(schedule, /probe\.timedTarget != TimedSpotifyTarget::None/);
  assert.match(schedule, /completedPrelude/);
  assert.match(schedule, /completedBridge/);
  assert.match(schedule, /timedPrioritySlotIndex_ = target->index/);
  assert.match(schedule, /detectedAt \+ kSpotifyTimedPriorityHoldMs/);
});

test('slow devices require repeated stalls before foreground recovery', () => {
  assert.match(schedule, /kSpotifyBackgroundStallConfirmations = 2/);
  assert.match(header, /int backgroundStallChecks = 0/);
  assert.match(
    schedule,
    /backgroundStallChecks <[\s\S]*kSpotifyBackgroundStallConfirmations[\s\S]*\+\+target->backgroundStallChecks/,
  );
  assert.match(
    schedule,
    /backgroundStallChecks >=[\s\S]*kSpotifyBackgroundStallConfirmations[\s\S]*timedUnhealthySinceTick/,
  );
});

test('heavy timed reconcile and fallback end polling are throttled', () => {
  assert.match(schedule, /kSpotifyTimedReconcileMinIntervalMs = 8ULL \* 1000ULL/);
  assert.match(header, /ULONGLONG lastTimedReconcileTick = 0/);
  assert.match(header, /ULONGLONG lastTimedObserverArmTick = 0/);
  assert.match(ended, /kSpotifyTimedObserverRearmMs = 10ULL \* 1000ULL/);
  assert.match(ended, /setInterval\(state\.check, 2500\)/);
  assert.doesNotMatch(
    ended,
    /previous && previous\.key === key && previous\.check[\s\S]*previous\.check\(\)/,
  );
});

test('recovery priority is a maximum hold and clears as soon as playback is healthy', () => {
  assert.match(
    schedule,
    /candidate\.playing[\s\S]*timedPrioritySlotIndex_ == candidate\.index[\s\S]*timedPrioritySlotIndex_ = kAccountCount[\s\S]*timedPriorityUntilTick_ = 0/,
  );
  assert.match(schedule, /maximum hold/);
});

test('a confirmed target-track ended event advances immediately', () => {
  assert.match(
    ended,
    /media\.addEventListener\('ended'[\s\S]*matchesTarget\(currentTrack\(\)\)[\s\S]*spotify:timed-ended/,
  );
  assert.match(
    ended,
    /An ended media element can also be an ad\/intermediate clip[\s\S]*spotify:timed-waiting/,
  );
});
