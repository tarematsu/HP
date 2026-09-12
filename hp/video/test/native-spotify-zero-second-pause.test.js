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

test('zero-second recovery uses only explicit Spotify Play-labelled controls', () => {
  assert.match(scoped, /const mediaPlaybackState = \(\) =>/);
  assert.match(scoped, /candidate\.tagName === 'AUDIO'/);
  assert.doesNotMatch(scoped, /requestMediaStart|__homePanelSpotifyPlayAttempt/);
  const executableScoped = scoped.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(executableScoped, /\.play\s*\(/);
  assert.match(scoped, /HTMLMediaElement\.play\(\) bypasses Spotify's own state machine/);

  const pauseUi = scoped.indexOf(
    "if (controlIntent === 'pause' || buttonIntentValue === 'pause')",
  );
  const rowPlay = scoped.indexOf(
    "if (buttonIntentValue === 'play') return point(button);",
    pauseUi,
  );
  const playerPlay = scoped.indexOf(
    "if (currentMatchesTarget && controlIntent === 'play') return point(control);",
    rowPlay,
  );
  assert.ok(pauseUi >= 0 && rowPlay > pauseUi && playerPlay > rowPlay);
  const recovery = scoped.slice(pauseUi, playerPlay + 100);
  assert.match(recovery, /return 'settling'/);
  assert.doesNotMatch(recovery, /media\.play|\.click\(\)/);
});

test('zero-second startup is not gated on Shuffle or Repeat mounting', () => {
  const start = music.indexOf('slot.lastModeNavigateTick = 0;');
  const reconcile = music.indexOf('kSpotifyStaticTrackReconcileScript', start);
  assert.ok(start >= 0 && reconcile > start);
  const startup = music.slice(start, reconcile);
  const playingGate = startup.indexOf('if (slot.state == SlotState::Playing)');
  const shuffle = startup.indexOf('PlaybackModeGuard::Shuffle');
  const repeat = startup.indexOf('PlaybackModeGuard::Repeat');
  assert.ok(playingGate >= 0 && shuffle > playingGate && repeat > shuffle);
});

test('native settling recovery waits or renavigates without ambiguous toggle clicks', () => {
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

test('music playback waits until the observer acknowledges the current generation', () => {
  assert.match(
    music,
    /if \(!slot\.timedObserverReady\) \{[\s\S]*ArmTimedEndObserver\(slot\);[\s\S]*return;/,
  );
  assert.match(runtime, /fields\[0\] === 'spotify:observer-sync'/);
  assert.match(runtime, /post\('spotify:observer-synced'\)/);
  assert.match(rotation, /L"spotify:observer-sync"/);
  assert.match(rotation, /L"spotify:observer-synced"/);
  assert.match(
    rotation,
    /if \(observerSynced\) \{[\s\S]*timedObserverReady = true;[\s\S]*ReconcileActiveTimedSlot\(\*target\)/,
  );
});

test('observer adoption of already-playing media also regenerates the native completion plan', () => {
  assert.match(
    runtime,
    /const status = enforceTarget\(media\);[\s\S]*status === 'playing'[\s\S]*runtime\.postCompletionPlan\(media\)/,
  );
  assert.match(
    runtime,
    /spotify:observer-sync[\s\S]*document\.querySelectorAll\('audio, video'\)[\s\S]*scheduleTargetChecks\(media\)/,
  );
});
