import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const music = source('spotify_music_target.inc');
const rotation = source('spotify_timed_end_rotation.inc');

test('music reconcile owns playback acceptance and deadline without observer acknowledgement', () => {
  const start = music.indexOf('if (json &&');
  const pointStart = music.indexOf('double cssX = 0.0;', start);
  assert.ok(start >= 0 && pointStart > start);
  const confirmation = music.slice(start, pointStart);
  assert.match(confirmation, /std::wstring_view\(json\) == L"true"/);
  assert.match(confirmation, /target->observedTrackTitle = currentTrack->title/);
  assert.match(confirmation, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(confirmation, /target->playbackConfirmed = true/);
  assert.match(confirmation, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(confirmation, /SetMusicCompletionDeadline\(\*target, callbackNow\)/);
  assert.doesNotMatch(confirmation, /ArmTimedEndObserver|observer-synced/);
  assert.doesNotMatch(confirmation, /direct-play|DirectPlay/);

  assert.match(runtime, /fields\[0\] === 'spotify:observer-sync'/);
  assert.match(runtime, /post\('spotify:observer-synced'\)/);
  assert.match(rotation, /L"spotify:observer-sync"/);
  assert.match(rotation, /L"spotify:observer-synced"/);
});

test('already-playing media remains supported by the optional page observer path', () => {
  assert.match(runtime, /document\.querySelectorAll\('audio, video'\)/);
  assert.match(runtime, /scheduleTargetChecks\(media\)/);
  assert.match(runtime, /const remainingMs = remainingDurationMs\(media\)/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.doesNotMatch(runtime, /postCompletionPlan/);
});
