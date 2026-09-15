import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const music = source('spotify_music_target.inc');
const rotation = source('spotify_timed_end_rotation.inc');

test('music reconcile leaves playback acceptance and deadline ownership to the observer', () => {
  const start = music.indexOf('if (json &&');
  const pointStart = music.indexOf('int x = 0;', start);
  assert.ok(start >= 0 && pointStart > start);
  const confirmation = music.slice(start, pointStart);
  assert.match(confirmation, /std::wstring_view\(json\) == L"true"/);
  assert.match(confirmation, /std::wstring_view\(json\) == L"\\"direct-play\\""/);
  assert.match(confirmation, /SetSlotState\(\*target, SlotState::WaitingTarget\)/);
  assert.match(confirmation, /nextRecoveryTick =[\s\S]*kSpotifyDirectPlayConfirmWaitMs/);
  assert.match(confirmation, /ArmTimedEndObserver\(\*target\)/);
  assert.doesNotMatch(confirmation, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.doesNotMatch(confirmation, /SetMusicCompletionDeadline/);

  assert.match(runtime, /fields\[0\] === 'spotify:observer-sync'/);
  assert.match(runtime, /post\('spotify:observer-synced'\)/);
  assert.match(rotation, /L"spotify:observer-sync"/);
  assert.match(rotation, /L"spotify:observer-synced"/);
  assert.match(rotation, /target->observedTrackTitle = currentTrack->title/);
  assert.match(rotation, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(rotation, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(rotation, /SetMusicCompletionDeadline\([\s\S]*remainingMs, resumed/);
});

test('already-playing media is adopted by the page observer status path', () => {
  assert.match(runtime, /document\.querySelectorAll\('audio, video'\)/);
  assert.match(runtime, /scheduleTargetChecks\(media\)/);
  assert.match(runtime, /const remainingMs = remainingDurationMs\(media\)/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.doesNotMatch(runtime, /postCompletionPlan/);
});
