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

test('zero-second startup is not gated on Shuffle, Repeat, or observer readiness', () => {
  const reconcileStart = music.indexOf('void SpotifyWebViews::ReconcileMusicTarget');
  const executeStart = music.indexOf('kSpotifyScopedTrackReconcileScript', reconcileStart);
  assert.ok(reconcileStart >= 0 && executeStart > reconcileStart);
  const startup = music.slice(reconcileStart, executeStart);
  assert.match(startup, /if \(slot\.asyncWork != AsyncWork::None\) return;/);
  assert.match(startup, /PostSpotifyTargetDescriptorForSlot\(slot\)/);
  assert.doesNotMatch(startup, /PlaybackModeGuard|EnsurePlaybackModeOff|shuffleOffVerified|repeatOffVerified/);
  assert.doesNotMatch(startup, /timedObserverReady|ArmTimedEndObserver/);
});

test('settling queues one recovery deadline without a renavigation branch', () => {
  const callbackStart = music.indexOf(
    'if (json && std::wstring_view(json) == L"\\"settling\\"")',
  );
  const pointStart = music.indexOf('int x = 0;', callbackStart);
  assert.ok(callbackStart >= 0 && pointStart > callbackStart);
  const callbackBranch = music.slice(callbackStart, pointStart);
  assert.match(callbackBranch, /SlotState::WaitingTarget/);
  assert.match(callbackBranch, /nextRecoveryTick = callbackNow \+ kSpotifyRecoveryRetryMs/);
  assert.doesNotMatch(callbackBranch, /NavigateMusicTarget|ShouldRenavigateUnhealthySlot|unhealthySinceTick/);
  assert.doesNotMatch(music, /"\\"wrong\\""|"\\"starting\\""|ShouldRenavigateUnhealthySlot|lastModeNavigateTick/);
});

test('startup and target-transition paths contain no executable generic media stop actuator', () => {
  assert.doesNotMatch(scripts, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(music, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(timed, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(music, executablePause);
  assert.doesNotMatch(timed, executablePause);
  assert.doesNotMatch(runtime, executablePause);
});

test('DOM reconcile directly confirms target playback from the visible pause state', () => {
  assert.match(
    scoped,
    /currentMatchesTarget &&[\s\S]*controlIntent === 'pause'[\s\S]*buttonIntentValue === 'pause'[\s\S]*return true/,
  );
  const trueBranch = music.slice(
    music.indexOf('if (json && std::wstring_view(json) == L"true")'),
    music.indexOf('if (json && std::wstring_view(json) == L"\\"settling\\"")'),
  );
  assert.match(trueBranch, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(trueBranch, /target->playbackConfirmed = true/);
  assert.match(trueBranch, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(trueBranch, /SetMusicCompletionDeadline\(\*target, callbackNow, 0, false\)/);
  assert.doesNotMatch(trueBranch, /SlotState::WaitingTarget/);
  assert.doesNotMatch(trueBranch, /nextRecoveryTick = callbackNow \+ kSpotifyRecoveryRetryMs/);
});

test('generation-tagged observer remains a generation-safe optional compatibility path', () => {
  assert.match(rotation, /ParseSpotifyStartedEvent/);
  assert.match(rotation, /ParseSpotifyResumedEvent/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.doesNotMatch(music, /ArmTimedEndObserver\(slot\)/);
});

test('music playback no longer waits for observer acknowledgement', () => {
  assert.doesNotMatch(music, /if \(!slot\.timedObserverReady\)/);
  assert.doesNotMatch(music, /ArmTimedEndObserver\(slot\)/);
  assert.match(scoped, /controlIntent === 'pause'/);
  assert.match(scoped, /buttonIntentValue === 'pause'/);
});

test('observer adoption of already-playing media still emits one start deadline if used', () => {
  assert.match(
    runtime,
    /spotify:observer-sync[\s\S]*document\.querySelectorAll\('audio, video'\)[\s\S]*scheduleTargetChecks\(media\)/,
  );
  assert.match(runtime, /const remainingMs = remainingDurationMs\(media\)/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.doesNotMatch(runtime, /postCompletionPlan/);
});
