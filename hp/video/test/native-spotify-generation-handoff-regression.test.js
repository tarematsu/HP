import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const music = source('spotify_music_target.inc');
const rotation = source('spotify_timed_end_rotation.inc');

test('music reconcile no longer waits for observer generation sync', () => {
  assert.doesNotMatch(music, /if \(!slot\.timedObserverReady\)/);
  assert.doesNotMatch(music, /ArmTimedEndObserver\(slot\)/);
  assert.match(music, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(music, /SetMusicCompletionDeadline\(\*target, callbackNow, 0, false\)/);

  // The generation-safe observer protocol may remain available as a compatible
  // secondary path, but it is no longer required before playback can be accepted.
  assert.match(runtime, /fields\[0\] === 'spotify:observer-sync'/);
  assert.match(runtime, /post\('spotify:observer-synced'\)/);
  assert.match(rotation, /L"spotify:observer-sync"/);
  assert.match(rotation, /L"spotify:observer-synced"/);
});

test('already-playing media can still be adopted by the optional observer path', () => {
  assert.match(runtime, /document\.querySelectorAll\('audio, video'\)/);
  assert.match(runtime, /scheduleTargetChecks\(media\)/);
  assert.match(runtime, /const remainingMs = remainingDurationMs\(media\)/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.doesNotMatch(runtime, /postCompletionPlan/);
});
