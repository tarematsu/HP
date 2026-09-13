import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url),
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
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url),
  'utf8',
);

test('native Spotify does not manage shuffle or repeat modes', () => {
  assert.doesNotMatch(wrapper, /spotify_playback_mode_guards/);
  assert.doesNotMatch(header, /shuffleOffVerified|repeatOffVerified|PlaybackModeGuard|EnsureShuffleOff|EnsurePlaybackModeOff/);
  assert.doesNotMatch(music, /shuffleOffVerified|repeatOffVerified|PlaybackModeGuard|EnsureShuffleOff|EnsurePlaybackModeOff/);
});

test('playback wrap cannot postpone the native deadline and ended may only shorten it', () => {
  assert.match(runtime, /state\.startPosted = true/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(events, /addEventListener\('ended', observeEnded, true\)/);
  assert.doesNotMatch(
    events,
    /addEventListener\('(?:timeupdate|seeking|seeked)'/,
  );
  assert.doesNotMatch(runtime + events, /terminalWrapObserved|completionPlanExpired|postCompletionPlan/);
  assert.match(rotation, /SpotifyDeadlineWithInterruptionHold/);
  assert.match(rotation, /effectiveDeadline > now[\s\S]*AdvanceTimedRotationSlot\(slot, now\)/i);
  assert.match(rotation, /spotify:timed-interruption-ended/);
  assert.match(rotation, /spotify:timed-ended/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd/);
  assert.doesNotMatch(rotation, /spotify:timed-plan/);
});
