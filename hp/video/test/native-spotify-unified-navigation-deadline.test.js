import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
const controller = readFileSync(
  new URL('../../native/src/spotify_controller_lifecycle.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url), 'utf8');

test('music duration and five-minute fallback arm one base deadline at Navigate', () => {
  const start = music.indexOf('void SpotifyWebViews::NavigateMusicTarget');
  const end = music.indexOf('\nvoid SpotifyWebViews::ReconcileMusicTarget', start);
  assert.ok(start >= 0 && end > start);
  const navigate = music.slice(start, end);

  assert.match(music, /kSpotifyNavigationFailsafeMs = 5ULL \* 60ULL \* 1000ULL/);
  assert.match(music, /kSpotifyNavigationCompletionGraceMs = 5ULL \* 1000ULL/);
  assert.match(navigate, /completionDelayMs = kSpotifyNavigationFailsafeMs/);
  assert.match(navigate, /timedCycleTracks\[slot\.timedRotationPosition\]\.durationMs/);
  assert.match(navigate, /std::min\(durationMs, maxDurationMs\)/);
  assert.match(
    navigate,
    /slot\.timedCompletionDeadlineTick\s*=\s*\n\s*slot\.lastModeNavigateTick \+ completionDelayMs/,
  );
  assert.match(navigate, /slot\.timedCompletionDeadlineGeneration = slot\.targetGeneration/);
  assert.match(navigate, /ArmCompletionDeadlineTimer\(\)/);
});

test('NavigationCompleted no longer owns a second duration deadline path', () => {
  assert.doesNotMatch(controller, /kSpotifyNavigationCompletionGraceMs/);
  assert.doesNotMatch(controller, /durationDeadline/);
  assert.doesNotMatch(
    controller,
    /timedCycleTracks\[target->timedRotationPosition\][\s\S]*durationMs/,
  );
});

test('measured ad time extends the same completion deadline', () => {
  assert.match(rotation, /ParseSpotifyInterruptionEndedEvent/);
  assert.match(
    rotation,
    /const ULONGLONG extension = std::min\([\s\S]*interruptionMs,[\s\S]*kSpotifyMaxInterruptionHoldMs\)/,
  );
  assert.match(
    rotation,
    /target->timedCompletionDeadlineTick\s*=\s*[\s\S]*target->timedCompletionDeadlineTick \+ extension/,
  );
  assert.doesNotMatch(rotation, /timedAdCompletionDeadlineTick/);
  assert.doesNotMatch(rotation, /timedAdvertisementDeadlineTick/);
});

test('active ads only hold the unified deadline temporarily', () => {
  assert.match(phase, /SpotifyDeadlineWithInterruptionHold/);
  assert.match(
    phase,
    /SpotifyDeadlineWithInterruptionHold\([\s\S]*slot\.timedCompletionDeadlineTick,[\s\S]*slot\.timedInterruptionStartTick/,
  );
});

test('the unified deadline still advances through the common rotation path', () => {
  const start = rotation.indexOf(
    'void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept');
  const end = rotation.indexOf('\nvoid SpotifyWebViews::ArmTimedEndObserver', start);
  assert.ok(start >= 0 && end > start);
  const due = rotation.slice(start, end);

  assert.match(due, /effectiveDeadline > now/);
  assert.match(due, /AdvanceTimedRotationSlot\(slot, now\)/);
});
