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

test('Spotify startup uses only a trusted Play click and never toggles Pause', () => {
  assert.match(scoped, /button\[data-testid="play-button"\]/);
  assert.match(scoped, /button\[data-testid="control-button-playpause"\]/);
  assert.match(scoped, /state\.playIssued = true/);
  assert.doesNotMatch(scoped, /button\.click\(\)|\.pause\s*\(/);
  assert.doesNotMatch(scoped, /ZeroSecondRestartPath|restartPending|return 'restart'/);
  assert.doesNotMatch(scoped, /audio\.play\(/);
  assert.doesNotMatch(scoped, /direct-play|DirectPlay/);
  assert.doesNotMatch(music, /direct-play|DirectPlay|"\\"restart\\""/);
});

test('first Play click and status probes use a two-second cadence', () => {
  assert.match(scripts, /__homePanelSpotifyNativeLoadedAt = Date\.now\(\)/);
  assert.match(scoped, /const playbackProbeMs = 2000/);
  assert.match(scoped, /const nativeLoadedAt = Number\(window\.__homePanelSpotifyNativeLoadedAt\)/);
  assert.match(scoped, /Date\.now\(\) - nativeLoadedAt < 2000/);
  assert.doesNotMatch(scripts + scoped, /performance\.now\(\)/);
});

test('target confirmation requires media-clock progress without zero-second restart state', () => {
  assert.match(scoped, /document\.querySelectorAll\('audio, video'\)/);
  assert.match(scoped, /__homePanelSpotifySimpleMediaProbe/);
  assert.match(scoped, /current > Number\(previous\.currentTime\) \+ 0\.05/);
  assert.match(scoped, /const failedSampleLimit = 4/);
  assert.match(scoped, /return 'startup-failure'/);
  assert.doesNotMatch(scoped, /stagnantSamples|ZeroSecondRestartPath|return 'restarted'/);
  assert.doesNotMatch(scoped, /pauseDecision|pagePause|playerPause/);
});

test('ads and progressing non-target media are observed without restart', () => {
  assert.match(scoped, /advertisementVisible \|\| \(activeMedia && !targetMatches\)/);
  assert.match(scoped, /resetFailures\(\)/);
  assert.doesNotMatch(scoped, /WrongTrackRecovery|pagePause\.click/);
});

test('startup is not gated on Shuffle, Repeat, or observer readiness', () => {
  const reconcileStart = music.indexOf('void SpotifyWebViews::ReconcileMusicTarget');
  const executeStart = music.indexOf('kSpotifyScopedTrackReconcileScript', reconcileStart);
  assert.ok(reconcileStart >= 0 && executeStart > reconcileStart);
  const startup = music.slice(reconcileStart, executeStart);
  assert.match(startup, /if \(slot\.asyncWork != AsyncWork::None\) return;/);
  assert.match(startup, /PostSpotifyTargetDescriptorForSlot\(slot\)/);
  assert.doesNotMatch(startup, /PlaybackModeGuard|EnsurePlaybackModeOff|shuffleOffVerified|repeatOffVerified/);
  assert.doesNotMatch(startup, /timedObserverReady|ArmTimedEndObserver/);
});

test('CDP Play is followed by two-second startup state probes', () => {
  assert.match(music, /kSpotifyPlaybackStateProbeMs = 2ULL \* 1000ULL/);
  assert.match(music, /kSpotifyCdpPlayRetryFailsafeMs = 5ULL \* 1000ULL/);
  assert.match(music, /std::wstring_view\(json\) == L"true"/);
  assert.match(music, /ParseCssPoint\(json, &cssX, &cssY\)/);
  assert.match(music, /ClickSlotCssPoint\(\*target, cssX, cssY\)/);
  assert.match(music, /target->playbackConfirmed = true/);
  assert.match(music, /SetMusicCompletionDeadline\(\*target, callbackNow\)/);
  assert.doesNotMatch(music, /kSpotifyCdpPlayConfirmWaitMs|kSpotifyDirectPlayConfirmWaitMs/);
  assert.doesNotMatch(music, /"\\"direct-play\\""|"\\"restart\\""/);
});

test('unready Spotify UI simply waits instead of entering another recovery sub-state', () => {
  assert.match(scoped, /return wait\(\)/);
  assert.match(music, /ParseSpotifyRetryDelay\(json\)/);
  assert.doesNotMatch(scoped, /transitionRetryDelays|nextTransitionRetryDelay/);
  assert.doesNotMatch(scoped, /MarkSlotRecovering|NavigateMusicTarget/);
});

test('startup and target-transition paths contain no executable generic media stop actuator', () => {
  assert.doesNotMatch(scripts, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(music, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(timed, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(scoped, executablePause);
  assert.doesNotMatch(music, executablePause);
  assert.doesNotMatch(timed, executablePause);
  assert.doesNotMatch(runtime, executablePause);
});

test('playback confirmation remains native-owned independently of status polling', () => {
  assert.match(scoped, /label\.includes\('pause'\) \|\| label\.includes\('一時停止'\)/);
  assert.doesNotMatch(
    controller,
    /add_DocumentTitleChanged|ICoreWebView2DocumentTitleChangedEventHandler/,
  );
  assert.match(music, /target->observedTrackTitle = currentTrack->title/);
  assert.match(music, /GetLocalTime\(&target->playbackConfirmedAt\)/);
  assert.match(music, /target->playbackConfirmed = true/);
  assert.match(music, /SetSlotState\(\*target, SlotState::Playing\)/);
  assert.match(rotation, /ParseSpotifyStartedEvent/);
  assert.match(rotation, /ParseSpotifyResumedEvent/);
});

test('observer adoption of already-playing media can still emit one start deadline if explicitly used', () => {
  assert.match(
    runtime,
    /spotify:observer-sync[\s\S]*document\.querySelectorAll\('audio, video'\)[\s\S]*scheduleTargetChecks\(media\)/,
  );
  assert.match(runtime, /const remainingMs = remainingDurationMs\(media\)/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.doesNotMatch(runtime, /postCompletionPlan/);
});
