import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const coordinator = source('audio_health_scan_coordinator.h');
const stationheadEvents = source('sh_webview_event_policy.h');
const stationheadLoss = source('sh_audio_loss.cpp');
const stationheadPolicy = source('sh_audio_loss_policy.h');
const stationheadRefresh = source('sh_track_boundary_message_policy.h');
const spotifyEvents = source('spotify_media_observer_events.inc');
const spotifyClick = source('spotify_background_click.inc');
const spotifyPhase = source('spotify_phase_sync.inc');
const spotifyTrackRecovery = source('spotify_track_start_recovery.h');

test('Stationhead keeps lightweight repair ahead of one-minute destructive recovery', () => {
  assert.match(stationheadEvents, /get_IsDocumentPlayingAudio/);
  assert.match(stationheadEvents, /__homepanelStationheadNativeAudioSeen/);
  assert.match(stationheadEvents, /nativeSetTimeout\(begin, 4000\)/);
  assert.match(stationheadEvents, /nativeSetInterval\([^]*2000\)/);
  assert.match(stationheadEvents, /attempts >= 4/);
  assert.match(stationheadEvents, /__homepanelPrimaryStationhead\?\.scan\?\.\(0\)/);
  assert.match(stationheadEvents, /media\.pause\(\)/);
  assert.match(stationheadEvents, /media\.play\?\.\(\)/);
  assert.match(stationheadEvents, /__homepanelStationheadBlockingLoginVisible/);
  assert.doesNotMatch(stationheadEvents, /location\.reload\(\)/);

  assert.match(stationheadPolicy, /kStationheadAudioLossGraceMs = 59'000/);
  assert.match(stationheadPolicy, /kStationheadAudioLossDomSettleMs = 1'000/);
  assert.match(stationheadLoss, /SetManagedPlaybackFallback/);
});

test('shared audio-health coordinator remains available to continuous-stream recovery', () => {
  assert.match(coordinator, /kAudioHealthScanCycleMs = 30ULL \* 1000ULL/);
  assert.match(coordinator, /kAudioHealthScanSlotSpacingMs = 5'000ULL/);
  assert.match(coordinator, /gAudioHealthScanInProgress/);
  assert.match(coordinator, /TryClaimAudioHealthScan/);
  assert.match(coordinator, /kAudioHealthScanMinimumGapMs = 4ULL \* 1000ULL/);
  assert.match(coordinator, /ReleaseAudioHealthScan/);
});

test('Stationhead polls native WebView2 audio through the periodic health path', () => {
  assert.match(stationheadRefresh, /PollPeriodicAudioHealth/);
  assert.match(stationheadRefresh, /AudioHealthScanDelayMs\(GetTickCount64\(\), 0\)/);
  assert.match(stationheadRefresh, /TryClaimAudioHealthScan\(scanTick\)/);
  assert.match(stationheadRefresh, /ReleaseAudioHealthScan\(\)/);
  assert.match(stationheadRefresh, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);
  assert.match(stationheadRefresh, /__homepanelPrimaryStationhead\?\.scan\?\.\(0\)/);
  assert.match(stationheadRefresh, /AttemptNativeStartClick\(nowMs\)/);
});

test('Spotify startup recovery is driven by each target URL generation', () => {
  assert.match(spotifyPhase, /BeginSpotifyTrackStartRecovery\([\s\S]*slot\.targetGeneration/);
  assert.match(spotifyTrackRecovery, /ULONGLONG generation = 0/);
  assert.match(spotifyTrackRecovery, /bool reloadIssued = false/);
  assert.match(spotifyTrackRecovery, /bool rebuildIssued = false/);
  assert.match(spotifyClick, /NextSpotifyTrackStartRecoveryAction/);
  assert.match(spotifyClick, /retry\.count>=2/);
  assert.match(spotifyClick, /return 'reload'/);
  assert.match(spotifyClick, /return 'recreate'/);
  assert.match(spotifyClick, /SpotifyTrackStartRecoveryAction::ReloadDocument/);
  assert.match(spotifyClick, /SpotifyTrackStartRecoveryAction::RebuildSurface/);
});

test('Spotify healthy playback is not enrolled in periodic native-audio scans', () => {
  assert.match(
    spotifyPhase,
    /std::array<ULONGLONG, 0> gSpotifyAudioHealthCheckDueTicks/,
  );
  assert.match(
    spotifyPhase,
    /std::array<ULONGLONG, 0> gSpotifyAudioHealthSilenceConfirmTicks/,
  );
  assert.match(
    spotifyPhase,
    /Healthy Spotify playback is event\/deadline driven/,
  );
  assert.match(
    spotifyClick,
    /slot\.playbackConfirmed && slot\.state == SlotState::Playing/,
  );
});

test('Spotify observer still reacts immediately to explicit playback interruption events', () => {
  assert.match(spotifyEvents, /recoveryGraceMs = 6000/);
  for (const eventName of ['pause', 'stalled', 'waiting', 'error']) {
    assert.match(spotifyEvents, new RegExp(`['\"]${eventName}['\"]`));
  }
  assert.match(spotifyEvents, /post\('spotify:timed-interrupted'\)/);
  assert.match(spotifyEvents, /next > recoveryTime \+ 0\.10/);
});

test('Stationhead keeps the explicit 50-minute preventive reload', () => {
  assert.match(stationheadRefresh, /return 50 \* 60'000;/);
  assert.match(stationheadRefresh, /L"50-minute periodic refresh"/);
});
