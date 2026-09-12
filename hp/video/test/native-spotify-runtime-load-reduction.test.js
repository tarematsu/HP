import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const events = source('spotify_media_observer_events.inc');
const bundle = source('spotify_fast_end_observer.inc');
const guards = source('spotify_playback_mode_guards.inc');
const phase = source('spotify_phase_sync.inc');

test('timed music observer installs no periodic or completion lifecycle probe', () => {
  assert.match(events, /document\.addEventListener\('play'/);
  assert.match(events, /document\.addEventListener\('playing'/);
  assert.match(events, /document\.addEventListener\('loadedmetadata'/);
  assert.match(events, /document\.addEventListener\('durationchange'/);
  assert.doesNotMatch(
    events,
    /addEventListener\('(?:timeupdate|seeking|seeked|waiting|stalled|pause|ended)'/,
  );
  assert.doesNotMatch(events, /setInterval|MutationObserver/);
  assert.match(runtime, /const enforceTarget = media =>/);
});

test('timed music observer contains no playback recovery heartbeat or completion loop', () => {
  assert.doesNotMatch(runtime, /requestRecovery|scheduleRecovery|recoveryPosted|restartPending/);
  assert.doesNotMatch(runtime, /heartbeatTimer|heartbeatMisses|startHeartbeat|stopHeartbeat/);
  assert.doesNotMatch(runtime, /spotify:not-playing|postCompletionPlan|clearCompletionPlan|probeCompletion/);
  assert.doesNotMatch(events, /scheduleRecovery|requestRecovery|spotify:not-playing/);
  assert.doesNotMatch(events, /setInterval|startHeartbeat|stopHeartbeat|quarantineCompletedGeneration/);
  assert.doesNotMatch(bundle, /kSpotifyMediaObserverHeartbeatScript|kSpotifyMediaObserverCompletionScript/);
});

test('shuffle and repeat mode verification shares one DOM probe and ExecuteScript round trip', () => {
  assert.match(guards, /kSpotifyPlaybackModesOffProbeScript/);
  assert.match(guards, /control-button-shuffle/);
  assert.match(guards, /control-button-repeat/);
  assert.equal(
    (guards.match(/ExecuteScript\(\s*kSpotifyPlaybackModesOffProbeScript/g) || []).length,
    1,
  );
  assert.match(guards, /target->shuffleOffVerified = true;/);
  assert.match(guards, /target->repeatOffVerified = true;/);
});

test('healthy native Spotify reconciliation sleeps up to 60 seconds', () => {
  assert.match(phase, /kSpotifyRobustHealthyTickMs = 60U \* 1000U/);
  assert.match(phase, /kSpotifyRobustUrgentTickMs = 2U \* 1000U/);
  assert.match(phase, /nextDeadlineMs = std::min\(nextDeadlineMs, boundary - elapsed\)/);
});
