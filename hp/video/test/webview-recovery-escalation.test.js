import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const environment = read('../../native/src/shared_webview_environment.cpp');
const environmentHeader = read('../../native/src/shared_webview_environment.h');
const spotifyLifecycle = read('../../native/src/spotify_controller_lifecycle.inc');
const spotifySchedule = read('../../native/src/spotify_stagger_schedule.inc');
const spotifyPhase = read('../../native/src/spotify_phase_sync.inc');

test('ready shared environment escalates only after repeated controller failures', () => {
  assert.match(environmentHeader, /readyInvalidationStrikes/);
  assert.match(environment, /kReadyInvalidationThreshold = 3/);
  assert.match(environment, /kReadyInvalidationWindowMs = 5ULL \* 60ULL \* 1000ULL/);
  assert.match(environment, /if \(entry\.readyInvalidationStrikes < kReadyInvalidationThreshold\) return/);
  assert.match(environment, /environmentToReset = entry\.environment/);
  assert.match(environment, /entry\.environment\.Reset\(\)/);
});

test('hard reset terminates only the shared WebView browser process', () => {
  assert.match(environment, /ICoreWebView2Environment8/);
  assert.match(environment, /GetProcessInfos\(&processes\)/);
  assert.match(environment, /COREWEBVIEW2_PROCESS_KIND_BROWSER/);
  assert.match(environment, /OpenProcess\(PROCESS_TERMINATE/);
  assert.match(environment, /TerminateProcess\(handle, ERROR_PROCESS_ABORTED\)/);
});

test('Spotify controller failures feed the shared-environment strike counter', () => {
  const invalidations = spotifyLifecycle.match(
    /SharedWebViewEnvironment::Instance\(\)\.Invalidate\(userDataFolder_\)/g,
  ) ?? [];
  assert.ok(invalidations.length >= 3);
});

test('Spotify startup and heavy rebuild work is staggered without low-memory mode', () => {
  assert.match(spotifySchedule, /kSpotifyInitialStartDelayMs = 5ULL \* 1000ULL/);
  assert.match(spotifySchedule, /kSpotifyHeavyRecoverySpacingMs = 5ULL \* 1000ULL/);
  assert.match(spotifySchedule, /gSpotifyNextHeavyRecoveryTick/);
  assert.match(
    spotifyPhase,
    /slot\.nextRecoveryTick != 0 && now < slot\.nextRecoveryTick[\s\S]*considerTick\(slot\.nextRecoveryTick\)/,
  );
  assert.doesNotMatch(
    spotifySchedule + spotifyLifecycle,
    /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW|put_MemoryUsageTargetLevel/,
  );
});
