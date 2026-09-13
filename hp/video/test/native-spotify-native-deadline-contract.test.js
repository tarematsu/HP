import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
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
  assert.match(due, /AdvanceTimedRotationSlot\(slot\)/);
  assert.doesNotMatch(due, /PostWebMessageAsString|spotify:completion-probe/);
});

test('same generation cannot extend the one-shot armed deadline', () => {
  assert.match(
    music,
    /timedCompletionDeadlineTick != 0[\s\S]*timedCompletionDeadlineGeneration == slot\.targetGeneration[\s\S]*return;/,
  );
  assert.match(rotation, /ArmMusicCompletionDeadlineFromStart\([\s\S]*remainingMs/);
  assert.doesNotMatch(rotation, /candidateDeadline|timed-plan-clear/);
});

test('ended can only shorten that same deadline', () => {
  assert.match(rotation, /L"spotify:timed-ended"/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd\(\*target, now\)/);
  assert.match(music, /timedCompletionDeadlineTick > endedTick/);
  assert.match(music, /timedCompletionDeadlineTick = endedTick/);
});
