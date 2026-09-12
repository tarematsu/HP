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

test('zero-second target media is resumed directly before Pause UI is treated as settling', () => {
  assert.match(scoped, /const mediaPlaybackState = \(\) =>/);
  assert.match(scoped, /media: pending/);
  assert.match(scoped, /const requestMediaStart = media =>/);
  assert.match(scoped, /const promise = media\.play\(\)/);
  assert.match(scoped, /now - last < 3000/);

  const directStart = scoped.indexOf(
    'if (currentMatchesTarget && mediaState.known && !mediaState.playing &&',
  );
  const pauseUi = scoped.indexOf(
    "if (controlIntent === 'pause' || buttonIntentValue === 'pause')",
  );
  assert.ok(directStart >= 0 && pauseUi > directStart);
  const startBranch = scoped.slice(directStart, pauseUi);
  assert.match(startBranch, /requestMediaStart\(mediaState\.media\)/);
  assert.match(startBranch, /return 'starting'/);
  assert.doesNotMatch(startBranch, /point\(/);
});

test('native starting and settling states wait or renavigate without ambiguous toggle clicks', () => {
  const start = music.indexOf(
    'if (json && (std::wstring_view(json) == L"\\"starting\\""',
  );
  const pointStart = music.indexOf('int x = 0;', start);
  assert.ok(start >= 0 && pointStart > start);
  const waitBranch = music.slice(start, pointStart);
  assert.match(waitBranch, /SlotState::WaitingTarget/);
  assert.match(waitBranch, /ShouldRenavigateUnhealthySlot/);
  assert.match(waitBranch, /NavigateMusicTarget/);
  assert.match(waitBranch, /\\"settling\\"/);
  assert.doesNotMatch(waitBranch, /ClickSlotNormalizedPoint/);
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
    music.indexOf('if (json && std::wstring_view(json) == L"\\"wrong\\"")'),
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
