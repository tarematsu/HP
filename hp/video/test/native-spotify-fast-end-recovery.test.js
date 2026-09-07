import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const observer = readFileSync(
  new URL('../../native/src/spotify_fast_end_observer.inc', import.meta.url),
  'utf8',
);
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url),
  'utf8',
);

test('confirmed target media ends immediately without metadata waiting', () => {
  assert.match(wrapper, /#include "spotify_fast_end_observer\.inc"/);
  assert.match(observer, /targetMedia/);
  assert.match(observer, /media\.addEventListener\('ended'/);
  assert.match(observer, /state\.targetMedia !== media/);
  assert.match(observer, /post\('spotify:timed-ended'\)/);
  assert.doesNotMatch(observer, /spotify:timed-waiting|waitForNext|setInterval/);
  assert.match(rotation, /ExecuteScript\(kSpotifyFastEndObserverScript/);
  assert.doesNotMatch(
    rotation,
    /ExecuteScript\(kSpotifyStaticEndObserverScript\s*,/,
  );
});

test('an advertisement play on the same media element relinquishes target ownership', () => {
  assert.match(
    observer,
    /if \(state\.targetMedia === media\)[\s\S]*state\.started = false;[\s\S]*state\.targetMedia = null;/,
  );
  assert.match(observer, /navigator\.mediaSession/);
});

test('pause or stall promotes only the affected slot for prompt recovery', () => {
  assert.match(observer, /media\.addEventListener\('pause'/);
  assert.match(observer, /setTimeout\([\s\S]*600\)/);
  assert.match(observer, /post\('spotify:not-playing'\)/);
  assert.match(rotation, /const bool stopped =[\s\S]*spotify:not-playing/);
  assert.match(rotation, /target->lastTimedReconcileTick = 0/);
  assert.match(rotation, /staggerSlotIndex_ = target->index/);
  assert.match(rotation, /staggerSlotValidated_ = false/);
});

test('four-minute actual-play deadline remains a fallback', () => {
  assert.match(rotation, /kSpotifyTimedTrackDeadlineMs = 4ULL \* 60ULL \* 1000ULL/);
  assert.match(rotation, /spotify:timed-started/);
  assert.match(rotation, /AdvanceExpiredTimedRotation/);
});
