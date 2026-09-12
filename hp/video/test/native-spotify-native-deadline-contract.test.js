import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');

test('native deadline directly advances A to the next rotation slot', () => {
  const dueStart = rotation.indexOf(
    'void SpotifyWebViews::ProbeDueTimedCompletions(ULONGLONG now) noexcept');
  const dueEnd = rotation.indexOf(
    '\nvoid SpotifyWebViews::ArmTimedEndObserver', dueStart);
  assert.ok(dueStart >= 0 && dueEnd > dueStart);
  const due = rotation.slice(dueStart, dueEnd);

  assert.match(due, /slot\.timedCompletionDeadlineTick = 0/);
  assert.match(due, /slot\.timedCompletionDeadlineGeneration = 0/);
  assert.match(due, /AdvanceTimedRotationSlot\(slot, now\)/);
  assert.doesNotMatch(due, /PostWebMessageAsString|spotify:completion-probe/);
});

test('same generation cannot extend the one-shot armed deadline', () => {
  const handlerStart = rotation.indexOf('const bool started = ParseSpotifyStartedEvent');
  const handlerEnd = rotation.indexOf('\n            }).Get(),', handlerStart);
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
  const handler = rotation.slice(handlerStart, handlerEnd);

  assert.match(handler, /target->timedCompletionDeadlineTick == 0/);
  assert.match(handler, /target->timedCompletionDeadlineGeneration != eventGeneration/);
  assert.match(handler, /target->timedCompletionDeadlineTick = now \+ remainingMs/);
  assert.doesNotMatch(handler, /candidateDeadline|timed-plan-clear/);
});
