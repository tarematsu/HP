import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const runtime = source('spotify_media_observer_runtime.inc');
const events = source('spotify_media_observer_events.inc');
const heartbeat = source('spotify_media_observer_heartbeat.inc');
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

test('heartbeat owns no interval while Spotify music is idle, paused, or naturally ended', () => {
  assert.match(heartbeat, /const startHeartbeat = \(\) =>/);
  assert.match(heartbeat, /const stopHeartbeat = \(\) =>/);
  assert.match(heartbeat, /clearInterval\(runtime\.heartbeatTimer\)/);
  assert.match(heartbeat, /runtime\.heartbeatTimer = setInterval\(heartbeat, 20000\)/);
  assert.match(heartbeat, /!state\.started[\s\S]*media\.paused \|\| media\.ended/);
  assert.doesNotMatch(heartbeat, /Array\.from\(document\.querySelectorAll/);
  assert.match(events, /document\.addEventListener\('pause'[\s\S]*stopHeartbeat\(\)/);
  assert.match(
    events,
    /state\.endedPosted = true;[\s\S]*stopHeartbeat\(\);[\s\S]*post\('spotify:timed-ended'\)/,
  );
  assert.match(
    events,
    /const quarantineCompletedGeneration = media =>[\s\S]*quarantineMedia\(media\)/,
  );
  assert.doesNotMatch(events, /stopAllMedia/);
  assert.match(runtime, /state\.recoveryPosted = true;[\s\S]*stopHeartbeatIfAvailable\(\);[\s\S]*post\('spotify:not-playing'\)/);
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
