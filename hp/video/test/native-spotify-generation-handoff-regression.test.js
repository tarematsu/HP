import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const music = source('spotify_music_target.inc');
const rotation = source('spotify_timed_end_rotation.inc');

test('music reconcile arms observer after playback is accepted without waiting for sync', () => {
  assert.doesNotMatch(music, /if \(!slot\.timedObserverReady\)/);
  assert.match(music, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(music, /SetMusicCompletionDeadline\(\*target, callbackNow, 0, false\)/);
  assert.match(music, /ArmTimedEndObserver\(\*target\)/);

  const accepted = music.indexOf('SetSlotState(*target, SlotState::Playing)');
  const observer = music.indexOf('ArmTimedEndObserver(*target)');
  assert.ok(accepted >= 0 && observer > accepted);

  // Playback acceptance remains independent from observer acknowledgement, while
  // the generation-safe observer now owns the visible status confirmation.
  assert.match(runtime, /fields\[0\] === 'spotify:observer-sync'/);
  assert.match(runtime, /post\('spotify:observer-synced'\)/);
  assert.match(rotation, /L"spotify:observer-sync"/);
  assert.match(rotation, /L"spotify:observer-synced"/);
  assert.match(rotation, /target->observedTrackTitle = currentTrack->title/);
  assert.match(rotation, /GetLocalTime\(&target->playbackConfirmedAt\)/);
});

test('already-playing media is adopted by the page observer status path', () => {
  assert.match(runtime, /document\.querySelectorAll\('audio, video'\)/);
  assert.match(runtime, /scheduleTargetChecks\(media\)/);
  assert.match(runtime, /const remainingMs = remainingDurationMs\(media\)/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.doesNotMatch(runtime, /postCompletionPlan/);
});
