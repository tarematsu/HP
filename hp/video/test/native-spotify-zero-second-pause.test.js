import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const scoped = source('spotify_scoped_track_reconcile.inc');
const music = source('spotify_music_target.inc');
const timed = source('spotify_timed_sequence.inc');
const scripts = source('spotify_static_scripts.inc');
const runtime = source('spotify_media_observer_runtime.inc');
const rotation = source('spotify_timed_end_rotation.inc');

const executablePause = /try\s*\{[^}]{0,240}\.pause\s*\(/s;

test('Pause-labelled Spotify UI at zero is a settling state, never a trusted click', () => {
  assert.match(scoped, /const buttonIntent = button =>/);
  assert.match(scoped, /includes\('pause'\).*return 'pause'/s);
  assert.match(scoped, /const mediaPlaybackState = \(\) =>/);
  assert.match(scoped, /!candidate\.ended && !candidate\.paused/);
  assert.match(
    scoped,
    /if \(controlIntent === 'pause' \|\| buttonIntentValue === 'pause'\) \{[\s\S]*return 'settling';/,
  );
  assert.match(scoped, /if \(buttonIntentValue === 'play'\) return point\(button\)/);
  assert.match(
    scoped,
    /if \(currentMatchesTarget && controlIntent === 'play'\) return point\(control\)/,
  );
});

test('native settling branch waits or renavigates and cannot click the ambiguous toggle', () => {
  const settlingStart = music.indexOf(
    'if (json && std::wstring_view(json) == L"\\"settling\\"")',
  );
  const pointStart = music.indexOf('int x = 0;', settlingStart);
  assert.ok(settlingStart >= 0 && pointStart > settlingStart);
  const settlingBranch = music.slice(settlingStart, pointStart);
  assert.match(settlingBranch, /SlotState::WaitingTarget/);
  assert.match(settlingBranch, /ShouldRenavigateUnhealthySlot/);
  assert.match(settlingBranch, /NavigateMusicTarget/);
  assert.doesNotMatch(settlingBranch, /ClickSlotNormalizedPoint/);
});

test('startup and target-transition paths contain no executable generic media stop actuator', () => {
  assert.doesNotMatch(scripts, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(music, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(timed, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(music, executablePause);
  assert.doesNotMatch(timed, executablePause);
  assert.doesNotMatch(runtime, executablePause);
});

test('DOM reconcile cannot promote a music slot to Playing by itself', () => {
  const trueBranch = music.slice(
    music.indexOf('if (json && std::wstring_view(json) == L"true")'),
    music.indexOf('if (json && std::wstring_view(json) == L"\\"settling\\"")'),
  );
  assert.match(trueBranch, /SlotState::WaitingTarget/);
  assert.doesNotMatch(trueBranch, /SetSlotState\(\*target, SlotState::Playing\)/);
});

test('generation-tagged observer remains the authority for confirmed music playback start', () => {
  assert.match(
    rotation,
    /if \(started\) \{[\s\S]*SetSlotState\(\*target, SlotState::Playing\)/,
  );
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
});
