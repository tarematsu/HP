import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const guards = readFileSync(
  new URL('../../native/src/spotify_playback_mode_guards.inc', import.meta.url),
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

test('native Spotify never inspects or changes repeat mode', () => {
  assert.doesNotMatch(header, /repeatOffVerified|PlaybackModeGuard/);
  assert.doesNotMatch(guards, /control-button-repeat|repeat one|disable repeat|enable repeat/i);
  assert.doesNotMatch(music, /repeatOffVerified|PlaybackModeGuard::Repeat|EnsurePlaybackModeOff/);
  assert.match(guards, /control-button-shuffle/);
  assert.match(music, /EnsureShuffleOff\(slot\)/);
});

test('playback wrap is irrelevant after native start deadline is armed', () => {
  assert.match(runtime, /state\.startPosted = true/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.doesNotMatch(
    events,
    /addEventListener\('(?:timeupdate|seeking|seeked|ended)'/,
  );
  assert.doesNotMatch(runtime + events, /terminalWrapObserved|completionPlanExpired|postCompletionPlan/);
  assert.match(rotation, /one-shot native deadline expires[\s\S]*AdvanceTimedRotationSlot\(slot, now\)/i);
  assert.doesNotMatch(rotation, /spotify:timed-ended|spotify:timed-plan/);
});
