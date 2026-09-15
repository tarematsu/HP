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

test('zero-second recovery tries target AUDIO play once per generation before Play controls', () => {
  assert.match(scoped, /const mediaPlaybackState = \(\) =>/);
  assert.match(scoped, /element: pending/);
  assert.match(scripts, /__homePanelSpotifyTryDirectPlay = media =>/);
  assert.match(scripts, /media\.tagName !== 'AUDIO'/);
  assert.match(scripts, /typeof media\.play !== 'function'/);
  assert.match(scripts, /__homePanelSpotifyDirectPlayGeneration === generation/);
  assert.match(scripts, /__homePanelSpotifyDirectPlayGeneration = generation/);
  assert.match(scripts, /const result = media\.play\(\)/);
  assert.match(scripts, /result\.catch\(\(\) => \{\}\)/);
  assert.match(scoped, /__homePanelSpotifyTryDirectPlay\(mediaState\.element\)/);
  assert.match(scoped, /return 'direct-play'/);
  assert.match(scoped, /buttonIntentValue === 'play'/);
  assert.match(scoped, /controlIntent === 'play'/);
  assert.ok(
    scoped.indexOf('__homePanelSpotifyTryDirectPlay(mediaState.element)') <
      scoped.indexOf("if (controlIntent === 'pause'"),
  );
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
  const directStart = music.indexOf(
    'if (json && std::wstring_view(json) == L"\\"direct-play\\"")',
  );
  const settlingStart = music.indexOf(
    'if (json && std::wstring_view(json) == L"\\"settling\\"")',
    directStart,
  );
  assert.ok(directStart >= 0 && settlingStart > directStart);
  const directBranch = music.slice(directStart, settlingStart);
  assert.match(directBranch, /SlotState::WaitingTarget/);
  assert.match(directBranch, /kSpotifyDirectPlayConfirmWaitMs/);
  assert.doesNotMatch(directBranch, /kSpotifyPlaybackStartRetryMs/);
  assert.match(directBranch, /ArmTimedEndObserver\(\*target\)/);
  assert.doesNotMatch(directBranch, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.doesNotMatch(directBranch, /ClickSlotNormalizedPoint/);

  const directAttempt = scoped.indexOf('__homePanelSpotifyTryDirectPlay(mediaState.element)');
  const buttonFallback = scoped.indexOf("if (buttonIntentValue === 'play')");
  assert.ok(directAttempt >= 0 && buttonFallback > directAttempt);
  assert.match(scripts, /__homePanelSpotifyDirectPlayGeneration === generation[\s\S]*return false/);
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

test('DOM reconcile requires active target media and leaves success to the observer', () => {
  assert.match(
    scoped,
    /currentMatchesTarget && mediaState\.known && mediaState\.playing\) return true/,
  );
  assert.doesNotMatch(
    scoped,
    /currentMatchesTarget &&[\s\S]{0,180}controlIntent === 'pause'[\s\S]{0,180}return true/,
  );
  const trueBranch = music.slice(
    music.indexOf('if (json && std::wstring_view(json) == L"true")'),
    music.indexOf('if (json && std::wstring_view(json) == L"\\"direct-play\\"")'),
  );
  assert.match(trueBranch, /SetSlotState\(\*target, SlotState::WaitingTarget\)/);
  assert.match(trueBranch, /kSpotifyPlaybackStartRetryMs/);
  assert.match(trueBranch, /ArmTimedEndObserver\(\*target\)/);
  assert.doesNotMatch(trueBranch, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.doesNotMatch(trueBranch, /SetMusicCompletionDeadline/);
  assert.doesNotMatch(controller, /add_DocumentTitleChanged/);
  assert.doesNotMatch(controller, /get_DocumentTitle/);
});

test('generation-tagged page observer owns status confirmation timing', () => {
  assert.match(rotation, /ParseSpotifyStartedEvent/);
  assert.match(rotation, /ParseSpotifyResumedEvent/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.match(rotation, /target->observedTrackTitle = currentTrack->title/);
  assert.match(rotation, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(rotation, /target->playbackConfirmed = true/);
  assert.match(music, /ArmTimedEndObserver\(\*target\)/);
});

test('DOM detection can arm the observer without title-based status confirmation', () => {
  assert.doesNotMatch(music, /DocumentTitleChanged|get_DocumentTitle/);
  assert.match(music, /ArmTimedEndObserver\(\*target\)/);
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
