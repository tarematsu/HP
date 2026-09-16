import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const wrapper = source('spotify_webviews.inc');
const header = source('spotify_webviews.h');
const music = source('spotify_music_target.inc');
const runtime = source('spotify_media_observer_runtime.inc');
const events = source('spotify_media_observer_events.inc');
const rotation = source('spotify_timed_end_rotation.inc');

test('native Spotify does not manage shuffle or repeat modes', () => {
  assert.doesNotMatch(wrapper, /spotify_playback_mode_guards/);
  assert.doesNotMatch(header + music, /shuffleOffVerified|repeatOffVerified|PlaybackModeGuard|EnsureShuffleOff|EnsurePlaybackModeOff/);
});

test('playback wrap cannot postpone the native deadline and ended may only shorten it', () => {
  assert.match(runtime, /state\.startPosted = true/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(events, /addEventListener\('timeupdate', observe, true\)/);
  assert.match(events, /addEventListener\('ended', observeEnded, true\)/);
  assert.doesNotMatch(events, /addEventListener\('(?:seeking|seeked)'/);
  assert.doesNotMatch(runtime + events, /terminalWrapObserved|completionPlanExpired|postCompletionPlan/);
  assert.match(rotation, /slot\.timedCompletionDeadlineTick > now/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(slot\)/);
  assert.match(rotation, /spotify:timed-resumed/);
  assert.match(rotation, /spotify:timed-ended/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd/);
  assert.doesNotMatch(rotation, /SpotifyDeadlineWithInterruptionHold|spotify:timed-plan/);
});
