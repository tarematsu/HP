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
const scoped = source('spotify_scoped_track_reconcile.inc');

test('observer posts one generation-fenced interruption event after target playback started', () => {
  assert.match(runtime, /interrupted: false/);
  assert.match(runtime, /state\.startPosted && !state\.interrupted/);
  assert.match(runtime, /state\.interrupted = true/);
  assert.match(runtime, /post\('spotify:timed-interrupted'\)/);
  assert.match(runtime, /return 'interruption'/);
  assert.match(events, /state\.interrupted/);
  assert.match(events, /addEventListener\('timeupdate', observe, true\)/);
  assert.match(events, /addEventListener\('loadedmetadata', observe, true\)/);
  assert.doesNotMatch(runtime, /interruptionStartedAt|timed-interruption-started|timed-interruption-ended|timed-interruption-cancelled/);
  assert.doesNotMatch(events, /addEventListener\('(?:pause|waiting|stalled)'/);
});

test('pre-confirmation playback start path has no raw-media or settling branch', () => {
  assert.match(runtime, /if \(!media\.paused\) \{[\s\S]*state\.startPosted && !state\.interrupted[\s\S]*return 'interruption'/);
  assert.match(scoped, /button\[data-testid="play-button"\]/);
  assert.match(scoped, /button\[data-testid="control-button-playpause"\]/);
  assert.doesNotMatch(scoped, /querySelector\('audio'\)|audio\.play\(|direct-play|return 'wrong'|return 'settling'|currentMatchesTarget/);
  assert.doesNotMatch(music, /"\\"wrong\\""|"\\"settling\\""|"\\"direct-play\\""/);
  assert.match(music, /callbackNow \+ kSpotifyTrackTransitionRetryMs/);
  assert.doesNotMatch(music, /ShouldRenavigateUnhealthySlot|lastModeNavigateTick/);
});

test('native clears the target completion deadline as soon as interruption is observed', () => {
  assert.match(rotation, /L"spotify:timed-interrupted"/);
  assert.match(rotation, /const bool interrupted =/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  const interruptedStart = rotation.indexOf('if (interrupted) {');
  const endedStart = rotation.indexOf('if (ended) {', interruptedStart);
  assert.ok(interruptedStart >= 0 && endedStart > interruptedStart);
  const interruptedBranch = rotation.slice(interruptedStart, endedStart);
  assert.match(interruptedBranch, /timedCompletionDeadlineTick = 0/);
  assert.match(interruptedBranch, /timedCompletionDeadlineGeneration = 0/);
  assert.match(interruptedBranch, /SetSlotState\(\*target, SlotState::WaitingTarget\)/);
  assert.match(interruptedBranch, /nextRecoveryTick = now \+ kSpotifyRecoveryRetryMs/);
  assert.match(interruptedBranch, /ArmRobustScheduler\(\)/);
  assert.doesNotMatch(interruptedBranch, /AdvanceTimedRotationSlot/);
});

test('natural target end cannot be cancelled by an ad that starts immediately after it', () => {
  const endedStart = events.indexOf('const observeEnded = event => {');
  const endedEnd = events.indexOf("document.addEventListener('playing'", endedStart);
  assert.ok(endedStart >= 0 && endedEnd > endedStart);
  const endedHandler = events.slice(endedStart, endedEnd);
  assert.match(endedHandler, /state\.startPosted = false/);
  assert.match(endedHandler, /state\.targetMedia = null/);
  assert.match(endedHandler, /post\('spotify:timed-ended'\)/);
  assert.ok(
    endedHandler.indexOf('state.startPosted = false') <
      endedHandler.indexOf("post('spotify:timed-ended')"),
  );
});

test('requested-song resume rebuilds deadline from actual remaining duration', () => {
  assert.match(runtime, /if \(state\.interrupted\)/);
  assert.match(runtime, /state\.interrupted = false/);
  assert.match(runtime, /postFields\('spotify:timed-resumed', String\(remainingMs\)\)/);
  assert.match(rotation, /ParseSpotifyResumedEvent/);
  assert.match(rotation, /const bool resumed =/);
  assert.match(rotation, /SetMusicCompletionDeadline\([\s\S]*remainingMs, resumed/);
  assert.match(music, /bool replaceExisting/);
});

test('interruption handling keeps no separate elapsed-time clock or hold cap', () => {
  assert.doesNotMatch(header, /timedInterruptionStartTick/);
  assert.doesNotMatch(phase, /kSpotifyMaxInterruptionHoldMs|SpotifyDeadlineWithInterruptionHold/);
  assert.doesNotMatch(rotation, /interruptionStarted|interruptionEnded|interruptionCancelled|interruptionMs/);
});

test('deadline expiry still advances only when an active deadline remains', () => {
  assert.match(music, /if \(!replaceExisting && slot\.timedCompletionDeadlineTick != 0/);
  const probeStart = rotation.indexOf(
    'void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept');
  const probeEnd = rotation.indexOf(
    '\nvoid SpotifyWebViews::ArmTimedEndObserver', probeStart);
  assert.ok(probeStart >= 0 && probeEnd > probeStart);
  const probe = rotation.slice(probeStart, probeEnd);
  assert.match(probe, /if \(slot\.timedCompletionDeadlineTick == 0\) continue/);
  assert.match(probe, /slot\.timedCompletionDeadlineTick > now/);
  assert.match(probe, /AdvanceTimedRotationSlot\(slot\)/);
  assert.doesNotMatch(probe, /NavigateMusicTarget|ReconcileMusicTarget/);
});
