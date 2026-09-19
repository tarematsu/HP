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
const spotifySchedule = source('spotify_stagger_schedule.inc');
const spotifyTrackRecovery = source('spotify_track_start_recovery.h');
const spotifyStartupAudio = source('spotify_startup_audio_recovery.inc');

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

test('shared audio-health coordinator keeps Stationhead on a true one-minute cycle', () => {
  assert.match(coordinator, /kAudioHealthScanCycleMs = 60ULL \* 1000ULL/);
  assert.match(coordinator, /kAudioHealthScanSlotSpacingMs = 10'000ULL/);
  assert.match(coordinator, /gAudioHealthScanInProgress/);
  assert.match(coordinator, /TryClaimAudioHealthScan/);
  assert.match(coordinator, /kAudioHealthScanMinimumGapMs = 4ULL \* 1000ULL/);
  assert.match(coordinator, /ReleaseAudioHealthScan/);
});

test('Stationhead polls native WebView2 audio through the periodic health path', () => {
  assert.match(stationheadRefresh, /StationheadAudioHealthCheckIntervalMs\(\) noexcept[\s\S]*return 1 \* 60'000;/);
  assert.match(stationheadRefresh, /PollPeriodicAudioHealth/);
  assert.match(stationheadRefresh, /AudioHealthScanDelayMs\(GetTickCount64\(\), 0\)/);
  assert.match(stationheadRefresh, /TryClaimAudioHealthScan\(scanTick\)/);
  assert.match(stationheadRefresh, /ReleaseAudioHealthScan\(\)/);
  assert.match(stationheadRefresh, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);
  assert.match(stationheadRefresh, /__homepanelPrimaryStationhead\?\.scan\?\.\(0\)/);
  assert.match(stationheadRefresh, /AttemptNativeStartClick\(nowMs\)/);
});

test('Spotify startup recovery is driven by each target URL generation and has a terminal skip', () => {
  assert.match(spotifyPhase, /BeginSpotifyTrackStartRecovery\([\s\S]*slot\.targetGeneration/);
  assert.match(spotifyTrackRecovery, /ULONGLONG generation = 0/);
  assert.match(spotifyTrackRecovery, /bool reloadIssued = false/);
  assert.match(spotifyTrackRecovery, /bool rebuildIssued = false/);
  assert.match(spotifyTrackRecovery, /bool skipIssued = false/);
  assert.match(spotifyTrackRecovery, /SkipTrack/);
  assert.match(spotifyClick, /EscalateSpotifyStartupFailure/);
  assert.match(spotifyClick, /retry\.count>=2/);
  assert.match(spotifyClick, /return 'reload'/);
  assert.match(spotifyClick, /return 'recreate'/);
  assert.match(spotifyStartupAudio, /SpotifyTrackStartRecoveryAction::ReloadDocument/);
  assert.match(spotifyStartupAudio, /SpotifyTrackStartRecoveryAction::RebuildSurface/);
  assert.match(spotifyStartupAudio, /SpotifyTrackStartRecoveryAction::SkipTrack/);
  assert.match(spotifyStartupAudio, /SkipFailedSpotifyTrack\(slot\)/);
});

test('Spotify checks native audio only during startup and requires consecutive positive samples', () => {
  assert.doesNotMatch(spotifyPhase, /AudioHealth|audioHealth/);
  assert.doesNotMatch(spotifySchedule, /gSpotifyAudioHealth/);
  assert.doesNotMatch(spotifySchedule, /TryClaimAudioHealthScan/);
  assert.doesNotMatch(spotifySchedule, /get_IsDocumentPlayingAudio/);
  assert.match(spotifySchedule, /No periodic IsDocumentPlayingAudio scan here/);
  assert.match(spotifyPhase, /kSpotifyNativeAudioStartRetryMs = 2ULL \* 1000ULL/);
  assert.match(spotifyStartupAudio, /kSpotifyNativeAudioStartCheckLimit = 4/);
  assert.match(spotifyStartupAudio, /gSpotifyNativeAudioFirstPassTicks/);
  assert.match(spotifyStartupAudio, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);
  assert.match(spotifyStartupAudio, /SpotifyMediaStartEvidenceReady/);
  assert.match(
    spotifyStartupAudio,
    /now - firstPassTick >= kSpotifyNativeAudioStartRetryMs/,
  );
  assert.match(spotifyStartupAudio, /slot\.nativeAudioStartVerified = true/);
  assert.match(
    spotifyClick,
    /slot\.playbackConfirmed && slot\.nativeAudioStartVerified/,
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
