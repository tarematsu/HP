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
const controller = source('spotify_controller_lifecycle.inc');

const executablePause = /try\s*\{[^}]{0,240}\.pause\s*\(/s;

test('zero-second recovery prioritizes target Play before AUDIO fallback', () => {
  assert.match(scoped, /button\[data-testid="play-button"\]/);
  assert.match(scoped, /button\[data-testid="control-button-playpause"\]/);
  assert.match(scoped, /isPauseControl\(pagePlay\)\) return true/);
  assert.match(scoped, /return point\(pagePlay\)/);
  assert.match(scoped, /const audio = document\.querySelector\('audio'\)/);
  assert.doesNotMatch(scoped, /audio && !audio\.paused && !audio\.ended\) return true/);
  assert.match(scoped, /audio && !audio\.paused && !audio\.ended\) return 'observing'/);
  assert.match(scoped, /__homePanelSpotifyDirectPlayGeneration !== generation/);
  assert.match(scoped, /__homePanelSpotifyDirectPlayGeneration = generation/);
  assert.match(scoped, /const result = audio\.play\(\)/);
  assert.match(scoped, /return 'direct-play'/);
  const targetControl = scoped.indexOf('const pagePlay');
  const audio = scoped.indexOf("const audio = document.querySelector('audio')");
  assert.ok(targetControl >= 0 && audio > targetControl);
  assert.doesNotMatch(scoped, /currentTrack|currentMatchesTarget|navigator\.mediaSession|buttonIntent|settling/);
  assert.doesNotMatch(scripts, /__homePanelSpotifyTryDirectPlay/);
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

test('direct audio play waits five seconds for observer confirmation before trusted-click fallback', () => {
  assert.match(music, /kSpotifyDirectPlayConfirmWaitMs = 5ULL \* 1000ULL/);
  assert.match(
    music,
    /std::wstring_view\(json\) == L"true"[\s\S]*std::wstring_view\(json\) == L"\\"direct-play\\""[\s\S]*callbackNow \+ kSpotifyDirectPlayConfirmWaitMs/,
  );
  assert.match(music, /ArmTimedEndObserver\(\*target\)/);
  assert.match(music, /ParseNormalizedPoint\(json, &x, &y\)/);
  assert.doesNotMatch(music, /kSpotifyPlaybackStartRetryMs/);
});

test('not-yet-created AUDIO or Play control is retried without a recovery sub-state machine', () => {
  const pointStart = music.indexOf('if (ParseNormalizedPoint(json, &x, &y))');
  const executeFailure = music.indexOf('if (FAILED(started))', pointStart);
  assert.ok(pointStart >= 0 && executeFailure > pointStart);
  const fallback = music.slice(pointStart, executeFailure);
  assert.match(fallback, /SetSlotState\(\*target, SlotState::WaitingTarget\)/);
  assert.match(fallback, /callbackNow \+ kSpotifyTrackTransitionRetryMs/);
  assert.doesNotMatch(fallback, /MarkSlotRecovering|NavigateMusicTarget|settling/);
});

test('startup and target-transition paths contain no executable generic media stop actuator', () => {
  assert.doesNotMatch(scripts, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(music, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(timed, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(music, executablePause);
  assert.doesNotMatch(timed, executablePause);
  assert.doesNotMatch(runtime, executablePause);
});

test('raw media activity is not accepted as target playback confirmation', () => {
  assert.doesNotMatch(scoped, /audio && !audio\.paused && !audio\.ended\) return true/);
  assert.match(scoped, /audio && !audio\.paused && !audio\.ended\) return 'observing'/);
  assert.match(scoped, /label\.includes\('pause'\) \|\| label\.includes\('一時停止'\)/);
  assert.doesNotMatch(controller, /add_DocumentTitleChanged/);
  assert.doesNotMatch(controller, /get_DocumentTitle/);
  assert.match(rotation, /ParseSpotifyStartedEvent/);
  assert.match(rotation, /ParseSpotifyResumedEvent/);
  assert.match(rotation, /target->observedTrackTitle = currentTrack->title/);
  assert.match(rotation, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(rotation, /target->playbackConfirmed = true/);
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
