import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/spotify_webviews.inc', import.meta.url),
  'utf8',
);
const bundle = readFileSync(
  new URL('../../native/src/spotify_fast_end_observer.inc', import.meta.url),
  'utf8',
);
const runtime = readFileSync(
  new URL('../../native/src/spotify_media_observer_runtime.inc', import.meta.url),
  'utf8',
);
const events = readFileSync(
  new URL('../../native/src/spotify_media_observer_events.inc', import.meta.url),
  'utf8',
);
const heartbeat = readFileSync(
  new URL('../../native/src/spotify_media_observer_heartbeat.inc', import.meta.url),
  'utf8',
);
const rotation = readFileSync(
  new URL('../../native/src/spotify_timed_end_rotation.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);
const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);
const timed = readFileSync(
  new URL('../../native/src/spotify_timed_sequence.inc', import.meta.url),
  'utf8',
);
const music = readFileSync(
  new URL('../../native/src/spotify_music_target.inc', import.meta.url),
  'utf8',
);
const phase = readFileSync(
  new URL('../../native/src/spotify_phase_sync.inc', import.meta.url),
  'utf8',
);

const executablePause = /try\s*\{[^}]{0,240}\.pause\s*\(/s;

test('observer responsibilities are independent scripts sharing one explicit runtime', () => {
  for (const file of [
    'spotify_media_observer_runtime.inc',
    'spotify_media_observer_events.inc',
    'spotify_media_observer_heartbeat.inc',
    'spotify_fast_end_observer.inc',
  ]) {
    assert.match(wrapper, new RegExp(`#include "${file.replace('.', '\\.')}"`));
  }
  assert.match(runtime, /__homePanelSpotifyMediaObserverRuntime/);
  assert.match(events, /runtime\.eventsInstalled/);
  assert.match(heartbeat, /runtime\.heartbeatTimer/);
  assert.match(bundle, /kSpotifyMediaObserverRuntimeScript/);
  assert.match(bundle, /kSpotifyMediaObserverEventsScript/);
  assert.match(bundle, /kSpotifyMediaObserverHeartbeatScript/);
  assert.doesNotMatch(bundle, /LR"JS\(/);
});

test('delegated media events cover current and dynamically created media', () => {
  assert.match(events, /document\.addEventListener\('play'/);
  assert.match(events, /document\.addEventListener\('playing'/);
  assert.match(events, /document\.addEventListener\('ended'/);
  assert.doesNotMatch(events, /media\.addEventListener/);
  assert.doesNotMatch(events, /MutationObserver|setInterval/);
});

test('confirmed target media starts and ends with its current generation', () => {
  assert.match(runtime, /state\.targetMedia = media/);
  assert.match(runtime, /post\('spotify:timed-started'\)/);
  assert.match(events, /state\.targetMedia !== media/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.match(runtime, /message \+ '\\u001f' \+ generation\(\)/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
  assert.doesNotMatch(runtime + events, /spotify:timed-waiting|waitForNext/);
});

test('direct track path is preferred over MediaSession title when both exist', () => {
  const domIdentity = runtime.indexOf('for (const selector of [');
  const mediaSession = runtime.indexOf('navigator.mediaSession');
  assert.ok(domIdentity >= 0 && mediaSession > domIdentity);
  assert.match(runtime, /if \(target\.trackPath && track\.path\)/);
  assert.match(runtime, /return sameTrackPath\(track\.path, target\.trackPath\)/);
  assert.match(runtime, /const sameTrackPath =/);
  assert.match(runtime, /value === expected/);
  assert.match(runtime, /value\.endsWith\(expected\)/);
});

test('start and recovery are non-destructive while completed-generation autoplay is quarantined', () => {
  assert.doesNotMatch(scripts, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(scripts, /if \(changed\)[\s\S]*media\.pause\(\)/);
  assert.doesNotMatch(runtime, executablePause);
  assert.doesNotMatch(music, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(timed, /kSpotifyStaticStopPlaybackScript/);
  assert.doesNotMatch(music, executablePause);
  assert.doesNotMatch(timed, executablePause);
  assert.doesNotMatch(rotation, /StopTimedOneShotPlayback|kSpotifyStaticStopPlaybackScript/);

  assert.match(
    events,
    /const quarantineCompletedGeneration = media =>[\s\S]*!state\.endedPosted[\s\S]*quarantineMedia\(media\)/,
  );
  assert.match(
    events,
    /state\.endedPosted = true;[\s\S]*post\('spotify:timed-ended'\)/,
  );
  const finishStart = events.indexOf('const finishTarget = media =>');
  const finishEnd = events.indexOf('\n  };', finishStart);
  assert.ok(finishStart >= 0 && finishEnd > finishStart);
  const finishTarget = events.slice(finishStart, finishEnd + '\n  };'.length);
  assert.doesNotMatch(finishTarget, /pause\(|quarantineMedia|stopAllMedia/);
  assert.match(events, /const finishLeadSeconds = 1\.5/);
  assert.match(events, /duration - finishLeadSeconds/);
  assert.match(events, /document\.addEventListener\('ended'[\s\S]*finishTarget\(event\.target\)/);
  assert.match(music, /PostSpotifyTargetDescriptorForSlot\(slot\);[\s\S]*Navigate\(target\.url\)/);
  assert.match(timed, /PostSpotifyTargetDescriptorForSlot\(slot\);[\s\S]*Navigate\(SpotifyPodcastUrl\(\)\)/);
});

test('pause, waiting, stalled, and silent media-clock freezes recover playback without forced stop', () => {
  assert.match(events, /document\.addEventListener\('pause'/);
  assert.match(events, /\['waiting', 'stalled'\]/);
  assert.match(events, /scheduleRecovery\(event\.target, 600, true\)/);
  assert.match(events, /scheduleRecovery\(event\.target, 2500, false\)/);
  assert.match(runtime, /currentTime > startTime \+ 0\.05/);
  assert.match(heartbeat, /setInterval\([\s\S]*10000\)/);
  assert.match(heartbeat, /heartbeatMisses >= 2/);
  assert.match(heartbeat, /requestRecovery\(media\)/);
  assert.match(runtime, /post\('spotify:not-playing'\)/);
  assert.match(rotation, /const bool stopped =[\s\S]*spotify:not-playing/);
  assert.doesNotMatch(runtime, executablePause);
});

test('observer injection is generation-fenced and a lost callback expires', () => {
  assert.match(header, /bool timedObserverReady = false/);
  assert.match(header, /bool timedObserverInstallInFlight = false/);
  assert.match(header, /ULONGLONG timedObserverInstallGeneration = 0/);
  assert.match(header, /ULONGLONG timedObserverInstallStartedTick = 0/);
  assert.match(
    rotation,
    /if \(slot\.timedObserverReady \|\| slot\.timedObserverInstallInFlight\) return;/,
  );
  assert.match(rotation, /\+\+slot\.timedObserverInstallGeneration/);
  assert.match(rotation, /observerTarget->timedObserverInstallGeneration !=[\s\S]*observerInstallGeneration/);
  assert.match(phase, /kSpotifyAsyncOperationTimeoutMs = 12ULL \* 1000ULL/);
  assert.match(phase, /slot\.timedObserverInstallInFlight[\s\S]*kSpotifyAsyncOperationTimeoutMs/);
});

test('music rotation has no time-based forced advance', () => {
  assert.doesNotMatch(header, /kSpotifyMusicTrackDeadlineMs/);
  assert.doesNotMatch(rotation, /AdvanceExpiredTimedRotation|kSpotifyMusicTrackDeadlineMs/);
  assert.doesNotMatch(phase, /kSpotifyMusicTrackDeadlineMs/);
  assert.match(events, /document\.addEventListener\('ended'/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(\*target, now\)/);
});