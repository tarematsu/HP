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

test('timeupdate keeps only numeric post-end checks and performs no DOM identity scan', () => {
  const start = events.indexOf("document.addEventListener('timeupdate'");
  const end = events.indexOf("document.addEventListener('pause'", start);
  assert.ok(start >= 0 && end > start);
  const timeupdate = events.slice(start, end);
  assert.doesNotMatch(timeupdate, /finishNearEnd|finishLeadSeconds|duration\s*-/);
  assert.match(timeupdate, /finishProjectedWrap\(media\)/);
  assert.doesNotMatch(timeupdate, /enforceTarget|lastIdentityCheckTime|querySelector/);
  assert.match(runtime, /const enforceTarget = media =>/);
});

test('timed music observer contains no playback recovery or heartbeat loop', () => {
  assert.doesNotMatch(runtime, /requestRecovery|scheduleRecovery|recoveryPosted|restartPending/);
  assert.doesNotMatch(runtime, /heartbeatTimer|heartbeatMisses|startHeartbeat|stopHeartbeat/);
  assert.doesNotMatch(runtime, /spotify:not-playing/);
  assert.doesNotMatch(events, /scheduleRecovery|requestRecovery|spotify:not-playing/);
  assert.doesNotMatch(events, /setInterval|startHeartbeat|stopHeartbeat/);
  assert.doesNotMatch(bundle, /kSpotifyMediaObserverHeartbeatScript/);
  assert.match(
    events,
    /const quarantineCompletedGeneration = media =>[\s\S]*quarantineMedia\(media\)/,
  );
  assert.doesNotMatch(events, /stopAllMedia/);
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
