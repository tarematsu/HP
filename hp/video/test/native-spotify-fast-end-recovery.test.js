import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const wrapper = source('spotify_webviews.inc');
const bundle = source('spotify_fast_end_observer.inc');
const runtime = source('spotify_media_observer_runtime.inc');
const events = source('spotify_media_observer_events.inc');
const music = source('spotify_music_target.inc');
const rotation = source('spotify_timed_end_rotation.inc');
const header = source('spotify_webviews.h');
const phase = source('spotify_phase_sync.inc');

test('observer bundle contains only runtime and minimal event bindings', () => {
  assert.match(wrapper, /spotify_media_observer_runtime\.inc/);
  assert.match(wrapper, /spotify_media_observer_events\.inc/);
  assert.match(bundle, /kSpotifyMediaObserverRuntimeScript/);
  assert.match(bundle, /kSpotifyMediaObserverEventsScript/);
  assert.doesNotMatch(wrapper + bundle, /spotify_media_observer_heartbeat|spotify_media_observer_completion/);
});

test('delegated media events cover startup identity and ended discovery without timers', () => {
  assert.match(events, /document\.addEventListener\('playing'/);
  assert.match(events, /document\.addEventListener\('durationchange'/);
  assert.match(events, /document\.addEventListener\('loadedmetadata'/);
  assert.match(events, /document\.addEventListener\('canplay'/);
  assert.match(events, /document\.addEventListener\('timeupdate'/);
  assert.match(events, /document\.addEventListener\('ended', observeEnded, true\)/);
  assert.doesNotMatch(events, /document\.addEventListener\('play'/);
  assert.doesNotMatch(events, /media\.addEventListener|MutationObserver|setInterval|setTimeout/);
});

test('confirmed target media publishes generation-tagged start resume and ended signals', () => {
  assert.match(runtime, /state\.targetMedia = media/);
  assert.match(runtime, /postFields\('spotify:timed-started', String\(remainingMs\)\)/);
  assert.match(runtime, /postFields\('spotify:timed-resumed', String\(remainingMs\)\)/);
  assert.match(events, /post\('spotify:timed-ended'\)/);
  assert.match(rotation, /eventGeneration != target->targetGeneration/);
});

test('direct track path is preferred over MediaSession title when both exist', () => {
  const domIdentity = runtime.indexOf('for (const selector of [');
  const mediaSession = runtime.indexOf('navigator.mediaSession');
  assert.ok(domIdentity >= 0 && mediaSession > domIdentity);
  assert.match(runtime, /sameTrackPath\(track\.path, expectedPath\)/);
});

test('completion does not mutate media and advances directly at the native deadline', () => {
  assert.doesNotMatch(runtime + events, /\.pause\s*\(|\.play\s*\(/);
  assert.match(rotation, /slot\.timedCompletionDeadlineTick > now/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(slot\)/);
  assert.doesNotMatch(rotation + phase, /SpotifyDeadlineWithInterruptionHold/);
});

test('observer injection uses the unified async epoch and EcoQoS-tolerant timeout', () => {
  assert.match(header, /bool timedObserverReady = false/);
  assert.match(header, /enum class AsyncWork/);
  assert.match(header, /ULONGLONG asyncEpoch = 0/);
  assert.match(rotation, /slot\.asyncWork != AsyncWork::None/);
  assert.match(rotation, /observerTarget->asyncEpoch != asyncEpoch/);
  assert.match(phase, /kSpotifyAsyncOperationTimeoutMs = 30ULL \* 1000ULL/);
  assert.doesNotMatch(header, /timedObserverInstallGeneration|timedObserverInstallInFlight/);
});

test('music rotation uses one native deadline shaped by start resume and ended shortening', () => {
  assert.doesNotMatch(header, /kSpotifyMusicTrackDeadlineMs/);
  assert.match(rotation, /SetMusicCompletionDeadline\([\s\S]*remainingMs, resumed/);
  assert.match(music, /kSpotifyNavigationCompletionGraceMs = 2ULL \* 1000ULL/);
  assert.match(rotation, /ShortenMusicCompletionDeadlineAtEnd/);
  assert.match(rotation, /AdvanceTimedRotationSlot\(slot\)/);
});
