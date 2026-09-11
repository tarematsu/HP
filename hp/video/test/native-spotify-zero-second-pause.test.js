import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const scoped = source('spotify_scoped_track_reconcile.inc');
const music = source('spotify_music_target.inc');
const rotation = source('spotify_timed_end_rotation.inc');

test('paused media at zero cannot be accepted only because Spotify UI says Pause', () => {
  assert.match(scoped, /const mediaPlaybackState = \(\) =>/);
  assert.match(scoped, /querySelectorAll\('audio, video'\)/);
  assert.match(scoped, /!candidate\.ended && !candidate\.paused/);
  assert.match(scoped, /return \{ known: true, playing: false \}/);
  assert.match(scoped, /const uiShowsPlaying =/);
  assert.match(
    scoped,
    /if \(uiShowsPlaying && \(!mediaState\.known \|\| mediaState\.playing\)\)/,
  );
});

test('DOM reconcile cannot promote a music slot to Playing by itself', () => {
  const trueBranch = music.slice(
    music.indexOf('if (json && std::wstring_view(json) == L"true")'),
    music.indexOf('int x = 0;'),
  );
  assert.match(trueBranch, /SlotState::WaitingTarget/);
  assert.doesNotMatch(trueBranch, /SetSlotState\(\*target, SlotState::Playing\)/);
});

test('generation-tagged observer remains the authority for confirmed playback start', () => {
  assert.match(
    rotation,
    /if \(started\) \{[\s\S]*SetSlotState\(\*target, SlotState::Playing\)/,
  );
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
});
