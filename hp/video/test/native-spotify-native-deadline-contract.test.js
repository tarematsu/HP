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

test('a repeated same-generation plan cannot extend the armed deadline', () => {
  const planStart = rotation.indexOf('if (planned) {');
  const planEnd = rotation.indexOf('\n              if (planCleared)', planStart);
  assert.ok(planStart >= 0 && planEnd > planStart);
  const plan = rotation.slice(planStart, planEnd);

  assert.match(plan, /candidateDeadline < target->timedCompletionDeadlineTick/);
  assert.match(plan, /target->timedCompletionDeadlineTick = candidateDeadline/);
});
