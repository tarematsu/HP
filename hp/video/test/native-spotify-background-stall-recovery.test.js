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

test('all six timed Spotify windows get a lightweight serialized stall probe', () => {
  assert.match(schedule, /kSpotifyBackgroundPlaybackProbeScript/);
  assert.match(schedule, /playbackWatchdogIndex_\+\+ % slots_\.size\(\)/);
  assert.match(schedule, /__homePanelSpotifyBackgroundProbe/);
  assert.match(schedule, /Math\.abs\(currentTime - state\.time\) < 0\.25/);
  assert.match(schedule, /return 'stalled'/);
  assert.match(schedule, /timedPrioritySlotIndex_ = target->index/);
  assert.match(schedule, /detectedAt \+ kSpotifyTimedPriorityHoldMs/);
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
