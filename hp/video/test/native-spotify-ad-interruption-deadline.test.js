import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const header = source('spotify_webviews.h');
const runtime = source('spotify_media_observer_runtime.inc');
const events = source('spotify_media_observer_events.inc');
const phase = source('spotify_phase_sync.inc');
const rotation = source('spotify_timed_end_rotation.inc');
const music = source('spotify_music_target.inc');

test('observer models non-target playback as one boolean interruption state', () => {
  assert.match(runtime, /interrupted: false/);
  assert.match(runtime, /state\.interrupted = true/);
  assert.match(runtime, /return 'interruption'/);
  assert.match(events, /state\.interrupted/);
  assert.doesNotMatch(runtime, /interruptionStartedAt|timed-interruption-started|timed-interruption-ended|timed-interruption-cancelled/);
  assert.doesNotMatch(events, /addEventListener\('(?:timeupdate|pause|waiting|stalled)'/);
});

test('requested-song resume sends remaining duration instead of elapsed interruption time', () => {
  assert.match(runtime, /if \(state\.interrupted\)/);
  assert.match(runtime, /postFields\('spotify:timed-resumed', String\(remainingMs\)\)/);
  assert.match(rotation, /ParseSpotifyResumedEvent/);
  assert.match(rotation, /const bool resumed =/);
  assert.match(rotation, /SetMusicCompletionDeadline\([\s\S]*remainingMs, resumed/);
});

test('native has no separate interruption clock or hold cap', () => {
  assert.doesNotMatch(header, /timedInterruptionStartTick/);
  assert.doesNotMatch(phase, /kSpotifyMaxInterruptionHoldMs|SpotifyDeadlineWithInterruptionHold/);
  assert.doesNotMatch(rotation, /interruptionStarted|interruptionEnded|interruptionCancelled|interruptionMs/);
});

test('resume replacement remains generation fenced and deadline expiry still fails forward', () => {
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.match(music, /bool replaceExisting/);
  assert.match(music, /if \(!replaceExisting && slot\.timedCompletionDeadlineTick != 0/);
  const probeStart = rotation.indexOf(
    'void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept');
  const probeEnd = rotation.indexOf(
    '\nvoid SpotifyWebViews::ArmTimedEndObserver', probeStart);
  assert.ok(probeStart >= 0 && probeEnd > probeStart);
  const probe = rotation.slice(probeStart, probeEnd);
  assert.match(probe, /slot\.timedCompletionDeadlineTick > now/);
  assert.match(probe, /AdvanceTimedRotationSlot\(slot\)/);
  assert.doesNotMatch(probe, /NavigateMusicTarget|ReconcileMusicTarget/);
});
