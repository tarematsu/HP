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
  assert.doesNotMatch(executableScoped, /\.play\s*\(|\.click\s*\(/);
  assert.match(scoped, /buttonIntentValue === 'play'/);
  assert.match(scoped, /controlIntent === 'play'/);
});

test('zero-second startup is not gated on Shuffle or Repeat mounting', () => {
  const reconcileStart = music.indexOf('void SpotifyWebViews::ReconcileMusicTarget');
  const executeStart = music.indexOf('kSpotifyScopedTrackReconcileScript', reconcileStart);
  assert.ok(reconcileStart >= 0 && executeStart > reconcileStart);
  const startup = music.slice(reconcileStart, executeStart);
  assert.match(startup, /if \(slot\.asyncWork != AsyncWork::None\) return;/);
  assert.match(startup, /PostSpotifyTargetDescriptorForSlot\(slot\)/);
  assert.doesNotMatch(startup, /PlaybackModeGuard|EnsurePlaybackModeOff|shuffleOffVerified|repeatOffVerified/);
});

test('settling queues one recovery deadline without a second renavigation watchdog', () => {
  const callbackStart = music.indexOf(
    'if (json && (std::wstring_view(json) == L"\\"starting\\""',
  );
  const pointStart = music.indexOf('int x = 0;', callbackStart);
  assert.ok(callbackStart >= 0 && pointStart > callbackStart);
  const callbackBranch = music.slice(callbackStart, pointStart);
  assert.match(callbackBranch, /SlotState::WaitingTarget/);
  assert.match(callbackBranch, /nextRecoveryTick = callbackNow \+ kSpotifyRecoveryRetryMs/);
  assert.doesNotMatch(callbackBranch, /ShouldRenavigateUnhealthySlot|unhealthySinceTick/);
  assert.doesNotMatch(music, /ShouldRenavigateUnhealthySlot|lastModeNavigateTick/);
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

test('generation-tagged observer remains authority for confirmed playback start and resume', () => {
  assert.match(rotation, /ParseSpotifyStartedEvent/);
  assert.match(rotation, /ParseSpotifyResumedEvent/);
  assert.match(rotation, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(rotation, /SetMusicCompletionDeadline\([\s\S]*\*target, now, remainingMs, resumed/);
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
  assert.match(rotation, /if \(observerSynced\) \{[\s\S]*asyncWork = AsyncWork::None;[\s\S]*timedObserverReady = true;[\s\S]*nextRecoveryTick = 0;/);
});

test('observer adoption of already-playing media emits one start deadline', () => {
  assert.match(
    runtime,
    /spotify:observer-sync[\s\S]*document\.querySelectorAll\('audio, video'\)[\s\S]*scheduleTargetChecks\(media\)/,
  );
  assert.match(runtime, /const remainingMs = remainingDurationMs\(media\)/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.doesNotMatch(runtime, /postCompletionPlan/);
});
