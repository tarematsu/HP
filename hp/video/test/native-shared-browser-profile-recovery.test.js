import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const sharedHeader = source('shared_webview_environment.h');
const shared = source('shared_webview_environment.cpp');
const spotifyHeader = source('spotify_webviews.h');
const controller = source('spotify_controller_lifecycle.inc');
const schedule = source('spotify_stagger_schedule.inc');

test('shared browser recycle waits for BrowserProcessExited before retiring environment', () => {
  assert.match(sharedHeader, /RecycleBrowserProcess/);
  assert.match(shared, /ICoreWebView2Environment5/);
  assert.match(shared, /add_BrowserProcessExited/);
  assert.match(shared, /HandleBrowserProcessExited/);
  assert.match(shared, /entry\.environment\.Reset\(\)/);
  assert.match(shared, /entry\.recyclePending = false/);
  assert.match(shared, /HRESULT_FROM_WIN32\(ERROR_RETRY\)/);
  assert.match(shared, /kSharedBrowserRecycleCooldownMs = 10ULL \* 60ULL \* 1000ULL/);
  assert.match(shared, /TerminateProcess\(process, kSharedBrowserRecycleExitCode\)/);
});

test('Spotify profile repair preserves authentication data and escalates in stages', () => {
  assert.match(spotifyHeader, /profileRecoveryStage/);
  assert.match(spotifyHeader, /profileRecoveryPending/);
  assert.match(controller, /ICoreWebView2Profile2/);
  assert.match(controller, /ClearBrowsingData/);
  assert.match(controller, /COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS/);
  assert.match(controller, /COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE/);
  assert.match(controller, /COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE/);
  assert.match(controller, /COREWEBVIEW2_BROWSING_DATA_KINDS_INDEXED_DB/);
  assert.doesNotMatch(controller, /COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES/);
  assert.doesNotMatch(controller, /COREWEBVIEW2_BROWSING_DATA_KINDS_LOCAL_STORAGE/);
  assert.doesNotMatch(controller, /COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE/);
  assert.match(schedule, /slot\.profileRecoveryStage == 0/);
  assert.match(schedule, /slot\.profileRecoveryStage == 1/);
  assert.match(schedule, /slot\.profileRecoveryStage == 2/);
  assert.match(schedule, /RecycleBrowserProcess/);
});

test('heavy Spotify recovery is serialized to avoid decoder and audio startup bursts', () => {
  assert.match(controller, /kSpotifyHeavyRecoverySpacingMs = 5ULL \* 1000ULL/);
  assert.match(controller, /gSpotifyHeavyRecoveryNextTick/);
  assert.match(controller, /slot\.nextRecoveryTick = std::max/);
  assert.match(schedule, /if \(slot\.profileRecoveryInFlight\) return/);
  assert.match(schedule, /if \(slot\.nextRecoveryTick != 0 && now < slot\.nextRecoveryTick\) continue/);
});
