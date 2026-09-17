import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const coordinator = source('media_recovery_coordinator.h');
const sharedHeader = source('shared_webview_environment.h');
const shared = source('shared_webview_environment.cpp');
const spotifyHeader = source('spotify_webviews.h');
const schedule = source('spotify_stagger_schedule.inc');

test('persistent Spotify recovery remains inside the unified coordinator', () => {
  assert.match(coordinator, /RepairPlaybackState = 5/);
  assert.match(coordinator, /DeepRepairPlaybackState = 6/);
  assert.match(coordinator, /RecycleEnvironment = 7/);
  assert.match(coordinator, /extendedRecoveryAvailable = false/);
  assert.match(coordinator, /MediaRecoveryExtendedRecoveryContract/);
  assert.match(schedule, /const bool extendedRecoveryAvailable =/);
  assert.match(
    schedule,
    /NextMediaRecoveryAction\([\s\S]*false,\s*extendedRecoveryAvailable\)/,
  );
  assert.doesNotMatch(schedule, /profileRecoveryStage/);
});

test('profile repair clears playback state without deleting authentication state', () => {
  assert.match(spotifyHeader, /profileRecoveryPending/);
  assert.match(spotifyHeader, /profileRecoveryInFlight/);
  assert.match(schedule, /ICoreWebView2Profile2/);
  assert.match(schedule, /ClearBrowsingData/);
  assert.match(schedule, /COREWEBVIEW2_BROWSING_DATA_KINDS_SERVICE_WORKERS/);
  assert.match(schedule, /COREWEBVIEW2_BROWSING_DATA_KINDS_CACHE_STORAGE/);
  assert.match(schedule, /COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE/);
  assert.match(schedule, /COREWEBVIEW2_BROWSING_DATA_KINDS_INDEXED_DB/);
  assert.doesNotMatch(schedule, /COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES/);
  assert.doesNotMatch(schedule, /COREWEBVIEW2_BROWSING_DATA_KINDS_LOCAL_STORAGE/);
  assert.doesNotMatch(schedule, /COREWEBVIEW2_BROWSING_DATA_KINDS_PASSWORD_AUTOSAVE/);
});

test('failed profile repair falls back instead of pretending the clear succeeded', () => {
  assert.match(
    schedule,
    /ICoreWebView2ClearBrowsingDataCompletedHandler>[\s\S]*\(HRESULT result\)/,
  );
  assert.match(
    schedule,
    /if \(FAILED\(result\)\) \{[\s\S]*mediaPipelineRecoveryPending = true;[\s\S]*nextRecoveryTick = GetTickCount64\(\);/,
  );
});

test('heavy surface recovery is serialized and shared browser recycle is bounded', () => {
  assert.match(schedule, /kSpotifyHeavyRecoverySpacingMs = 5ULL \* 1000ULL/);
  assert.match(schedule, /gSpotifyHeavyRecoveryNextTick/);
  assert.match(schedule, /slot\.nextRecoveryTick = std::max/);
  assert.match(schedule, /MediaRecoveryAction::RecycleEnvironment/);
  assert.match(schedule, /RecycleBrowserProcess/);
  assert.match(sharedHeader, /RecycleBrowserProcess/);
  assert.match(shared, /ICoreWebView2Environment5/);
  assert.match(shared, /add_BrowserProcessExited/);
  assert.match(shared, /HRESULT_FROM_WIN32\(ERROR_RETRY\)/);
  assert.match(shared, /kSharedBrowserRecycleCooldownMs = 10ULL \* 60ULL \* 1000ULL/);
  assert.match(shared, /TerminateProcess\(process, kSharedBrowserRecycleExitCode\)/);
});

test('rejected browser recycle rebuilds only the incident owner', () => {
  const recycle = schedule.slice(schedule.indexOf('MediaRecoveryAction::RecycleEnvironment'));
  assert.match(recycle, /if \(recycling\) \{[\s\S]*for \(Slot& affected : slots_\)/);
  assert.match(
    recycle,
    /else \{[\s\S]*slot\.mediaPipelineRecoveryPending = true;[\s\S]*SetSlotState\(slot, SlotState::Recovering\);/,
  );
  const rejected = recycle.slice(recycle.indexOf('} else {'));
  assert.doesNotMatch(rejected.split('RecomputeForeground')[0], /for \(Slot& affected : slots_\)/);
});

test('rejected browser recycle blocks extended recovery for one recycle cooldown', () => {
  assert.match(spotifyHeader, /extendedRecoveryBlockedUntilTick/);
  assert.match(
    schedule,
    /kSpotifyRejectedRecycleBackoffMs\s*=\s*[\s\S]*10ULL \* 60ULL \* 1000ULL/,
  );
  assert.match(
    schedule,
    /extendedRecoveryAvailable\s*=\s*[\s\S]*extendedRecoveryBlockedUntilTick == 0[\s\S]*now >= slot\.extendedRecoveryBlockedUntilTick/,
  );
  assert.match(
    schedule,
    /slot\.extendedRecoveryBlockedUntilTick\s*=\s*[\s\S]*now \+ kSpotifyRejectedRecycleBackoffMs/,
  );
  assert.match(
    schedule,
    /if \(recycling\) \{[\s\S]*affected\.extendedRecoveryBlockedUntilTick = 0;/,
  );
  assert.match(
    schedule,
    /slot\.mediaPipelineRecoveryPending = true;[\s\S]*slot\.nextRecoveryTick = now;[\s\S]*ResetMediaRecoveryEpisode/,
  );
});