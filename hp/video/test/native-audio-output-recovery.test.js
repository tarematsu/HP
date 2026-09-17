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

test('shared audio-health coordinator serializes four 30-second scan slots', () => {
  assert.match(coordinator, /kAudioHealthScanCycleMs = 30ULL \* 1000ULL/);
  assert.match(coordinator, /kAudioHealthScanSlotSpacingMs = 7'500ULL/);
  assert.match(coordinator, /kAudioHealthScanSlotCount = 4/);
  assert.match(coordinator, /gAudioHealthScanInProgress/);
  assert.match(coordinator, /TryClaimAudioHealthScan/);
  assert.match(coordinator, /kAudioHealthScanMinimumGapMs = 5ULL \* 1000ULL/);
  assert.match(coordinator, /ReleaseAudioHealthScan/);
});

test('Stationhead polls native WebView2 audio through shared 30-second slot zero', () => {
  assert.match(stationheadRefresh, /PollPeriodicAudioHealth/);
  assert.match(stationheadRefresh, /AudioHealthScanDelayMs\(GetTickCount64\(\), 0\)/);
  assert.match(stationheadRefresh, /TryClaimAudioHealthScan\(scanTick\)/);
  assert.match(stationheadRefresh, /ReleaseAudioHealthScan\(\)/);
  assert.match(stationheadRefresh, /get_IsDocumentPlayingAudio\(&nativePlaying\)/);
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

test('Spotify checks one live lane at a time on 7.5-second staggered phases', () => {
  assert.match(spotifyPhase, /kSpotifyAudioHealthCheckMs = 30ULL \* 1000ULL/);
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

test('Spotify requires a second 30-second silent native sample before recovery', () => {
  assert.match(spotifyPhase, /kSpotifyAudioHealthSilenceConfirmMs = 30ULL \* 1000ULL/);
  assert.match(spotifyPhase, /gSpotifyAudioHealthSilenceConfirmTicks/);
  assert.match(spotifySchedule, /gSpotifyAudioHealthSilenceConfirmTicks\.fill\(0\)/);
  assert.match(spotifySchedule, /nativePlaying != FALSE[\s\S]*silenceConfirm = 0/);
  assert.match(
    spotifySchedule,
    /silenceConfirm = now \+ kSpotifyAudioHealthSilenceConfirmMs/,
  );
  assert.match(spotifySchedule, /else if \(now < silenceConfirm\)/);
  assert.match(
    spotifySchedule,
    /else \{[\s\S]*silenceConfirm = 0;[\s\S]*SetSlotState\(slot, SlotState::WaitingTarget\)/,
  );
  assert.match(
    spotifySchedule,
    /MediaRecoveryEvidence::TimelineStall[\s\S]*MediaRecoveryAction::ReassertPlayback/,
  );
  assert.doesNotMatch(
    spotifySchedule,
    /slot\.recoveryEpisode, MediaRecoveryEvidence::ConfirmedSilence/,
  );
});

test('Stationhead keeps the explicit 50-minute preventive reload', () => {
  assert.match(stationheadRefresh, /return 50 \* 60'000;/);
  assert.match(stationheadRefresh, /L"50-minute periodic refresh"/);
});
