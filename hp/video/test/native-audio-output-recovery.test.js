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

test('Stationhead actively repairs silence before the existing fallback boundary', () => {
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

  // The bounded event-driven repair loop still finishes before the audited
  // auth/fallback state machine takes over at 11/12 seconds.
  assert.match(stationheadPolicy, /kStationheadAudioLossGraceMs = 11'000/);
  assert.match(stationheadPolicy, /kStationheadAudioLossDomSettleMs = 1'000/);
  assert.match(stationheadLoss, /SetManagedPlaybackFallback/);
});

test('shared audio-health coordinator serializes four one-minute scan slots', () => {
  assert.match(coordinator, /kAudioHealthScanCycleMs = 60ULL \* 1000ULL/);
  assert.match(coordinator, /kAudioHealthScanSlotSpacingMs = 15ULL \* 1000ULL/);
  assert.match(coordinator, /kAudioHealthScanSlotCount = 4/);
  assert.match(coordinator, /gAudioHealthScanInProgress/);
  assert.match(coordinator, /TryClaimAudioHealthScan/);
  assert.match(coordinator, /kAudioHealthScanMinimumGapMs = 5ULL \* 1000ULL/);
  assert.match(coordinator, /ReleaseAudioHealthScan/);
});

test('Stationhead polls native WebView2 audio once per minute in shared slot zero', () => {
  assert.match(
    stationheadRefresh,
    /StationheadAudioHealthCheckIntervalMs\(\)[\s\S]*return 1 \* 60'000/,
  );
  assert.match(stationheadRefresh, /PollPeriodicAudioHealth/);
  assert.match(stationheadRefresh, /AudioHealthScanDelayMs\(GetTickCount64\(\), 0\)/);
  assert.match(stationheadRefresh, /TryClaimAudioHealthScan\(scanTick\)/);
  assert.match(stationheadRefresh, /ReleaseAudioHealthScan\(\)/);
  assert.match(stationheadRefresh, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);
  assert.match(
    stationheadRefresh,
    /ApplyAudioPlaybackState\(playing, L"1-minute native audio health check"\)/,
  );
  assert.match(stationheadRefresh, /__homepanelPrimaryStationhead\?\.scan\?\.\(0\)/);
  assert.match(stationheadRefresh, /AttemptNativeStartClick\(nowMs\)/);
});

test('Spotify sustained silence returns to trusted click and reload recovery', () => {
  assert.match(spotifyEvents, /recoveryGraceMs = 6000/);
  for (const eventName of ['pause', 'stalled', 'waiting', 'error']) {
    assert.match(spotifyEvents, new RegExp(`['\"]${eventName}['\"]`));
  }
  assert.match(spotifyEvents, /post\('spotify:timed-interrupted'\)/);
  assert.match(spotifyEvents, /next > recoveryTime \+ 0\.10/);
  assert.match(
    spotifyClick,
    /slot\.playbackConfirmed && slot\.state == SlotState::Playing/,
  );
  assert.match(spotifyClick, /retry\.count>=2/);
  assert.match(spotifyClick, /return 'reload'/);
});

test('Spotify checks one live lane at a time on 15-second staggered phases', () => {
  assert.match(spotifyPhase, /kSpotifyAudioHealthCheckMs = 1ULL \* 60ULL \* 1000ULL/);
  assert.match(spotifyPhase, /NextAudioHealthScanTick\([\s\S]*static_cast<size_t>\(lane\) \+ 1/);
  assert.match(spotifySchedule, /Slot\* audioHealthCandidate = nullptr/);
  assert.match(spotifySchedule, /audioHealthPhase = phase/);
  assert.match(spotifySchedule, /TryClaimAudioHealthScan\(now\)/);
  assert.match(spotifySchedule, /ReleaseAudioHealthScan\(\)/);
  assert.match(spotifySchedule, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);
  assert.match(spotifySchedule, /timedCompletionDeadlineTick = 0/);
  assert.match(spotifySchedule, /SetSlotState\(slot, SlotState::WaitingTarget\)/);
  assert.match(spotifySchedule, /slot\.nextRecoveryTick = now/);
});
