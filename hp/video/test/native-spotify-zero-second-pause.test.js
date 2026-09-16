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

test('zero-second recovery starts playback only through trusted CDP Play click', () => {
  assert.match(scoped, /button\[data-testid="play-button"\]/);
  assert.match(scoped, /button\[data-testid="control-button-playpause"\]/);
  assert.match(scoped, /pageButtons\.some\(isPauseControl\)/);
  assert.match(scoped, /playerPause && currentTrackMatchesTarget\(\)/);
  assert.match(scoped, /return point\(visiblePageButton\)/);
  assert.doesNotMatch(scoped, /point\(playerPause\)|querySelector\('audio'\)/);
  assert.doesNotMatch(scoped, /audio\.play\(/);
  assert.doesNotMatch(scoped, /direct-play|DirectPlay/);
  assert.doesNotMatch(music, /direct-play|DirectPlay/);
});

test('first Play click waits one second after page bootstrap', () => {
  assert.match(scripts, /__homePanelSpotifyNativeLoadedAt = performance\.now\(\)/);
  assert.match(scoped, /const nativeLoadedAt = Number\(window\.__homePanelSpotifyNativeLoadedAt\)/);
  assert.match(scoped, /performance\.now\(\) - nativeLoadedAt >= 1000/);
  assert.match(scoped, /if \(!initialPlayDelayElapsed\) return null;\s*return point\(visiblePageButton\)/);
});

test('Pause confirmation requires media-clock progress and restarts a zero-second stall', () => {
  assert.match(scoped, /document\.querySelectorAll\('audio, video'\)/);
  assert.match(scoped, /__homePanelSpotifyProgressProbe/);
  assert.match(scoped, /current > previous\.currentTime \+ 0\.05/);
  assert.match(scoped, /now - previous\.sampledAt < 1000/);
  assert.match(scoped, /button\.click\(\)/);
  assert.match(scoped, /return 'restarted'/);
  assert.match(scoped, /return confirmPause\(visiblePageButton\) \? true : null/);
  assert.match(scoped, /return pagePause && confirmPause\(pagePause\) \? true : null/);
  assert.match(scoped, /return confirmPause\(playerPause\) \? true : null/);
  assert.doesNotMatch(scoped, /media\.play\(/);
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

test('CDP Play waits five seconds for native Pause-state confirmation', () => {
  assert.match(music, /kSpotifyCdpPlayConfirmWaitMs = 5ULL \* 1000ULL/);
  assert.match(music, /std::wstring_view\(json\) == L"true"/);
  assert.match(music, /callbackNow \+ kSpotifyCdpPlayConfirmWaitMs/);
  assert.match(music, /ParseCssPoint\(json, &cssX, &cssY\)/);
  assert.match(music, /ClickSlotCssPoint\(\*target, cssX, cssY\)/);
  assert.match(music, /target->playbackConfirmed = true/);
  assert.match(music, /SetMusicCompletionDeadline\(\*target, callbackNow\)/);
  assert.doesNotMatch(music, /kSpotifyDirectPlayConfirmWaitMs/);
  assert.doesNotMatch(music, /"\\"direct-play\\""/);
});

test('not-yet-created Play control is retried without a recovery sub-state machine', () => {
  const pointStart = music.indexOf('if (ParseCssPoint(json, &cssX, &cssY))');
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
