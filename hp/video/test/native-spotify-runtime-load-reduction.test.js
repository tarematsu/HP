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
const layout = source('spotify_host_layout.inc');
const header = source('spotify_webviews.h');
const environment = source('shared_webview_environment.cpp');

test('timeupdate target identity work is throttled to once per ten playback seconds', () => {
  assert.match(runtime, /lastIdentityCheckTime: -1/);
  assert.match(events, /const identityCheckIntervalSeconds = 10/);
  assert.match(
    events,
    /currentTime - state\.lastIdentityCheckTime < identityCheckIntervalSeconds/,
  );
  assert.match(events, /state\.lastIdentityCheckTime = currentTime;[\s\S]*enforceTarget\(media\)/);
  assert.match(events, /loadedmetadata[\s\S]*durationchange[\s\S]*state\.lastIdentityCheckTime = -1/);
});

test('startup identity checks use only three bounded wakeups', () => {
  assert.match(runtime, /\[0, 1500, 5000\]\.forEach/);
  assert.doesNotMatch(runtime, /\[0, 250, 1000, 2500, 5000\]/);
});

test('heartbeat owns no interval while idle and uses a low-frequency silent-stall fallback', () => {
  assert.match(heartbeat, /const startHeartbeat = \(\) =>/);
  assert.match(heartbeat, /const stopHeartbeat = \(\) =>/);
  assert.match(heartbeat, /clearInterval\(runtime\.heartbeatTimer\)/);
  assert.match(heartbeat, /runtime\.heartbeatTimer = setInterval\(heartbeat, 30000\)/);
  assert.match(heartbeat, /!state\.started[\s\S]*media\.paused \|\| media\.ended/);
  assert.doesNotMatch(heartbeat, /Array\.from\(document\.querySelectorAll/);
  assert.match(events, /document\.addEventListener\('pause'[\s\S]*stopHeartbeat\(\)/);
  assert.match(
    events,
    /state\.endedPosted = true;[\s\S]*stopHeartbeat\(\);[\s\S]*post\('spotify:timed-ended'\)/,
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

test('verified healthy music WebViews enter a compact low-memory rendering state', () => {
  assert.match(layout, /kSpotifyLowPowerPlaybackWidth = 96/);
  assert.match(layout, /kSpotifyLowPowerPlaybackHeight = 54/);
  assert.match(
    layout,
    /slot\.state == SlotState::Playing[\s\S]*slot\.timedTarget == TimedSpotifyTarget::Music[\s\S]*slot\.shuffleOffVerified[\s\S]*slot\.repeatOffVerified/,
  );
  assert.match(layout, /ComPtr<ICoreWebView2_19> memoryView/);
  assert.match(layout, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.match(layout, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/);
  assert.match(header, /hostLowPowerMask_ = ~0u/);
  assert.match(header, /hostMemoryTargetApplied = false/);
});

test('shared WebView environment permits autoplay but restores Chromium occlusion throttling', () => {
  assert.match(environment, /--autoplay-policy=no-user-gesture-required/);
  assert.doesNotMatch(environment, /--disable-backgrounding-occluded-windows/);
  assert.match(environment, /--disable-domain-reliability/);
  assert.match(environment, /--disable-breakpad/);
  assert.match(environment, /--disable-extensions/);
  assert.match(environment, /--disable-sync/);
  assert.match(environment, /--metrics-recording-only/);
});
