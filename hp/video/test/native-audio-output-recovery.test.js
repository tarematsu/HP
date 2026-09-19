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
const stationheadRecovery = source('sh_track_boundary_message_policy.h');
const spotifyEvents = source('spotify_media_observer_events.inc');
const spotifyClick = source('spotify_background_click.inc');
const spotifyPhase = source('spotify_phase_sync.inc');
const spotifySchedule = source('spotify_stagger_schedule.inc');
const spotifyTrackRecovery = source('spotify_track_start_recovery.h');
const spotifyStartupAudio = source('spotify_startup_audio_recovery.inc');

test('Stationhead has no independent event-driven pause-play repair loop', () => {
  assert.doesNotMatch(stationheadEvents, /UpdateStationheadSilentPlaybackRecovery/);
  assert.doesNotMatch(stationheadEvents, /__homepanelStationheadSilentRecoveryTimer/);
  assert.doesNotMatch(stationheadEvents, /nativeSetTimeout\(begin, 4000\)/);
  assert.doesNotMatch(stationheadEvents, /nativeSetInterval/);
  assert.doesNotMatch(stationheadEvents, /media\.pause\(\)|media\.play\?\.\(\)/);

  assert.match(stationheadPolicy, /kStationheadAudioLossGraceMs = 59'000/);
  assert.match(stationheadPolicy, /kStationheadAudioLossDomSettleMs = 1'000/);
  assert.match(stationheadRecovery, /StationheadAudioRecoveryStage/);
  assert.match(stationheadRecovery, /RecoveryStage::LightRepair/);
  assert.match(stationheadRecovery, /RecoveryStage::Reload/);
  assert.match(stationheadRecovery, /RecoveryStage::Rebuild/);
  assert.match(stationheadRecovery, /RecoveryStage::Fallback/);
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

test('Stationhead one-minute health path observes audio without performing playback repair', () => {
  assert.match(stationheadRecovery, /StationheadAudioHealthCheckIntervalMs\(\) noexcept[\s\S]*return 1 \* 60'000;/);
  assert.match(stationheadRecovery, /PollPeriodicAudioHealth/);
  assert.match(stationheadRecovery, /AudioHealthScanDelayMs\(GetTickCount64\(\), 0\)/);
  assert.match(stationheadRecovery, /TryClaimAudioHealthScan\(scanTick\)/);
  assert.match(stationheadRecovery, /ReleaseAudioHealthScan\(\)/);
  assert.match(stationheadRecovery, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);

  const start = stationheadRecovery.indexOf('void PollPeriodicAudioHealth(int64_t nowMs)');
  const end = stationheadRecovery.indexOf(
    '::hp::StationheadAudioRecoveryStage audioLossRecoveryStage_', start);
  assert.ok(start >= 0 && end > start);
  const health = stationheadRecovery.slice(start, end);
  assert.match(health, /ApplyAudioPlaybackState/);
  assert.doesNotMatch(health, /__homepanelPrimaryStationhead|AttemptNativeStartClick|media\.play|media\.pause/);
});

test('Stationhead lightweight repair is issued once by the bounded recovery ladder', () => {
  const start = stationheadRecovery.indexOf('void EscalateAudioLossRecovery(int64_t nowMs)');
  const end = stationheadRecovery.indexOf('void PollPeriodicAudioHealth', start);
  assert.ok(start >= 0 && end > start);
  const recovery = stationheadRecovery.slice(start, end);
  assert.match(recovery, /kLightRepairScript/);
  assert.match(recovery, /__homepanelPrimaryStationhead\?\.scan\?\.\(0\)/);
  assert.match(recovery, /AttemptNativeStartClick\(nowMs\)/);
  assert.match(recovery, /NavigateCurrentUrl\(nowMs, L"audio-loss recovery reload"\)/);
  assert.match(recovery, /ScheduleRecreate\(L"Stationhead silence recovery WebView rebuild"/);
  assert.match(recovery, /SetManagedPlaybackFallback/);
  assert.doesNotMatch(recovery, /media\.pause\(\)|media\.play\?\.\(\)/);
});

test('Spotify startup recovery is per target generation and is reload-once then skip', () => {
  assert.match(spotifyPhase, /BeginSpotifyTrackStartRecovery\([\s\S]*slot\.targetGeneration/);
  assert.match(spotifyTrackRecovery, /ULONGLONG generation = 0/);
  assert.match(spotifyTrackRecovery, /bool reloadIssued = false/);
  assert.match(spotifyTrackRecovery, /ConsumeSpotifyStartupReload/);
  assert.doesNotMatch(spotifyTrackRecovery, /rebuildIssued|skipIssued|RebuildSurface/);
  assert.doesNotMatch(spotifyClick, /NativePlayRetry|return 'reload'|return 'recreate'/);
  assert.doesNotMatch(spotifyClick, /EscalateSpotifyStartupFailure/);
  assert.match(spotifyStartupAudio, /ConsumeSpotifyStartupReload/);
  assert.match(spotifyStartupAudio, /slot\.webview->Reload\(\)/);
  assert.match(spotifyStartupAudio, /SkipFailedSpotifyTrack\(slot\)/);
  assert.doesNotMatch(spotifyStartupAudio, /RequestSpotifyAudioPipelineRestart|RebuildSurface/);
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

test('Stationhead does not use a preventive periodic page reload', () => {
  assert.doesNotMatch(stationheadRecovery, /StationheadPeriodicRefreshIntervalMs/);
  assert.doesNotMatch(stationheadRecovery, /RefreshPeriodicNavigation/);
  assert.doesNotMatch(stationheadRecovery, /50-minute periodic refresh/);
});
