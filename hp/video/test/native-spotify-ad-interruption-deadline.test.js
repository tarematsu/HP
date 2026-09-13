import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url), 'utf8');
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url), 'utf8');
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');

test('observer measures only provisional non-track interruptions', () => {
  assert.match(runtime, /ULONGLONG|interruptionStartedAt/);
  assert.match(runtime, /!media\.paused && !identity\.path/);
  assert.match(runtime, /spotify:timed-interruption-started/);
  assert.match(runtime, /spotify:timed-interruption-ended/);
  assert.match(runtime, /spotify:timed-interruption-cancelled/);
  assert.match(runtime, /cancelInterruption\(\)[\s\S]*return 'wrong'/);
  assert.doesNotMatch(
    events,
    /addEventListener\('(?:timeupdate|pause|waiting|stalled)'/,
  );
  assert.match(events, /state\.interruptionStartedAt/);
  assert.match(events, /state\.targetMedia !== media/);
});

test('native keeps an active interruption generation-local and bounded', () => {
  assert.match(header, /ULONGLONG timedInterruptionStartTick = 0/);
  assert.match(phase, /kSpotifyMaxInterruptionHoldMs = 5ULL \* 60ULL \* 1000ULL/);
  assert.match(phase, /SpotifyDeadlineWithInterruptionHold/);
  assert.match(
    phase,
    /SpotifyDeadlineWithInterruptionHold\([\s\S]*slot\.timedInterruptionStartTick/,
  );
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.match(rotation, /target->timedInterruptionStartTick = now/);
});

test('completed interruption adds only its measured bounded duration', () => {
  assert.match(rotation, /ParseSpotifyInterruptionEndedEvent/);
  assert.match(rotation, /const ULONGLONG extension = std::min\([\s\S]*interruptionMs,[\s\S]*kSpotifyMaxInterruptionHoldMs\)/);
  assert.match(
    rotation,
    /target->timedCompletionDeadlineTick \+ extension/,
  );
  assert.match(
    rotation,
    /interruptionCancelled[\s\S]*target->timedInterruptionStartTick = 0[\s\S]*ArmCompletionDeadlineTimer\(\)/,
  );
});

test('deadline expiry respects the active interruption hold then still fails forward', () => {
  const probeStart = rotation.indexOf(
    'void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept');
  const probeEnd = rotation.indexOf(
    '\nvoid SpotifyWebViews::ArmTimedEndObserver', probeStart);
  assert.ok(probeStart >= 0 && probeEnd > probeStart);
  const probe = rotation.slice(probeStart, probeEnd);

  assert.match(probe, /SpotifyDeadlineWithInterruptionHold/);
  assert.match(probe, /effectiveDeadline > now/);
  assert.match(probe, /slot\.timedInterruptionStartTick = 0/);
  assert.match(probe, /AdvanceTimedRotationSlot\(slot\)/);
});
