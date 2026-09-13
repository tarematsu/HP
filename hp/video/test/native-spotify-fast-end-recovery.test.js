import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url), 'utf8');
const bundle = readFileSync(
  new URL('../../native/src/spotify_fast_end_observer.inc', import.meta.url), 'utf8');
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url), 'utf8');
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url), 'utf8');
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url), 'utf8');
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url), 'utf8');
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url), 'utf8');
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url), 'utf8');

test('observer bundle contains only runtime and minimal event bindings', () => {
  for (const file of [
    'spotify_media_observer_runtime.inc',
    'spotify_media_observer_events.inc',
    'spotify_fast_end_observer.inc',
  ]) {
    assert.match(wrapper, new RegExp(`#include "${file.replace('.', '\\.')}"`));
  }
  assert.doesNotMatch(wrapper, /spotify_media_observer_heartbeat\.inc/);
  assert.doesNotMatch(wrapper, /spotify_media_observer_completion\.inc/);
  assert.match(runtime, /__homePanelSpotifyMediaObserverRuntime/);
  assert.match(events, /runtime\.eventsInstalled/);
  assert.match(bundle, /kSpotifyMediaObserverRuntimeScript/);
  assert.match(bundle, /kSpotifyMediaObserverEventsScript/);
  assert.doesNotMatch(bundle, /kSpotifyMediaObserverCompletionScript|kSpotifyMediaObserverHeartbeatScript/);
});

test('delegated media events cover start plus best-effort ended discovery without polling', () => {
  assert.match(events, /document\.addEventListener\('play'/);
  assert.match(events, /document\.addEventListener\('playing'/);
  assert.match(events, /document\.addEventListener\('loadedmetadata'/);
  assert.match(events, /document\.addEventListener\('durationchange'/);
  assert.match(events, /document\.addEventListener\('ended', observeEnded, true\)/);
  assert.doesNotMatch(events, /media\.addEventListener|MutationObserver|setInterval/);
  assert.doesNotMatch(events, /addEventListener\('timeupdate'/);
});

test('confirmed target media publishes one generation-tagged remaining duration and validated ended signal', () => {
  assert.match(runtime, /state\.targetMedia = media/);
  assert.match(runtime, /const remainingMs = remainingDurationMs\(media\)/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(runtime, /\[message, generation\(\), \.\.\.fields\]\.join\('\\u001f'\)/);
  assert.match(events, /state\.targetMedia !== media/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.doesNotMatch(runtime + events, /spotify:timed-waiting|spotify:timed-plan/);
});

test('direct track path is preferred over MediaSession title when both exist', () => {
  const domIdentity = runtime.indexOf('for (const selector of [');
  const mediaSession = runtime.indexOf('navigator.mediaSession');
  assert.ok(domIdentity >= 0 && mediaSession > domIdentity);
  assert.match(runtime, /if \(target\.trackPath && track\.path\)/);
  assert.match(runtime, /return sameTrackPath\(track\.path, target\.trackPath\)/);
});

test('completion does not mutate the Spotify media element and advances at the effective deadline', () => {
  assert.doesNotMatch(runtime + events, /\.pause\s*\(|\.play\s*\(/);
  assert.doesNotMatch(runtime + events, /endedPosted|quarantineCompletedGeneration|finishTarget|finishProjectedWrap/);
  assert.match(rotation, /SpotifyDeadlineWithInterruptionHold/);
  assert.match(rotation, /effectiveDeadline > now[\s\S]*AdvanceTimedRotationSlot\(slot, now\)/i);
});

test('pause waiting stalled and target mismatch never request playback recovery', () => {
  assert.doesNotMatch(events, /scheduleRecovery|requestRecovery|spotify:not-playing/);
  assert.doesNotMatch(runtime, /scheduleRecovery|requestRecovery|spotify:not-playing/);
  assert.doesNotMatch(runtime, /recoveryPosted|restartPending|heartbeat/);
  assert.doesNotMatch(rotation, /const bool stopped|spotify:not-playing/);
});

test('observer injection is generation-fenced and a lost callback expires', () => {
  assert.match(header, /bool timedObserverReady = false/);
  assert.match(header, /bool timedObserverInstallInFlight = false/);
  assert.match(header, /ULONGLONG timedObserverInstallGeneration = 0/);
  assert.match(header, /ULONGLONG timedObserverInstallStartedTick = 0/);
  assert.match(rotation, /if \(slot\.timedObserverReady \|\| slot\.timedObserverInstallInFlight\) return;/);
  assert.match(rotation, /\+\+slot\.timedObserverInstallGeneration/);
  assert.match(phase, /kSpotifyAsyncOperationTimeoutMs = 12ULL \* 1000ULL/);
});

test('music rotation uses one native deadline shaped by start duration ads and ended shortening', () => {
  assert.doesNotMatch(header, /kSpotifyMusicTrackDeadlineMs/);
  assert.doesNotMatch(events, /finishLeadSeconds|duration - finishLeadSeconds/);
  assert.match(rotation, /ArmMusicCompletionDeadlineFromStart\([\s\S]*remainingMs/);
  assert.match(music, /kSpotifyNavigationCompletionGraceMs = 2ULL \* 1000ULL/);
  assert.match(rotation, /timedCompletionDeadlineTick \+ extension/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(slot, now\)/);
});
