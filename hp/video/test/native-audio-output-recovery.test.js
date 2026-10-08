import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url),
  'utf8',
);

const coordinator = source('audio_health_scan_coordinator.h');
const profilePolicy = source('sh_playback_resource_policy_fix.h');
const stationheadEvents = source('sh_webview_event_policy.h');
const stationheadLoss = source('sh_audio_loss.cpp');
const stationheadPolicy = source('sh_audio_loss_policy.h');
const stationheadRecovery = source('sh_track_boundary_message_policy.h');

test('Stationhead has no independent event-driven pause-play repair loop', () => {
  assert.doesNotMatch(stationheadEvents, /UpdateStationheadSilentPlaybackRecovery/);
  assert.doesNotMatch(stationheadEvents, /__homepanelStationheadSilentRecoveryTimer/);
  assert.doesNotMatch(stationheadEvents, /nativeSetTimeout\(begin, 4000\)/);
  assert.doesNotMatch(stationheadEvents, /nativeSetInterval/);
  assert.doesNotMatch(stationheadEvents, /media\.pause\(\)|media\.play\?\.\(\)/);

  assert.match(stationheadPolicy, /kStationheadAudioLossGraceMs = 120'000/);
  assert.match(stationheadPolicy, /kStationheadAudioLossDomSettleMs = 1'000/);
  assert.match(stationheadRecovery, /StationheadAudioRecoveryStage/);
  assert.match(stationheadRecovery, /RecoveryStage::LightRepair/);
  assert.match(stationheadRecovery, /RecoveryStage::Reload/);
  assert.match(stationheadRecovery, /RecoveryStage::Rebuild/);
  assert.match(stationheadRecovery, /RecoveryStage::Fallback/);
  assert.match(stationheadLoss, /SetManagedPlaybackFallback/);
});

test('shared audio-health coordinator spaces six Stationhead profiles one minute apart', () => {
  assert.match(coordinator, /kAudioHealthScanCycleMs = 6ULL \* 60ULL \* 1000ULL/);
  assert.match(coordinator, /kAudioHealthScanSlotSpacingMs = 60ULL \* 1000ULL/);
  assert.match(coordinator, /kAudioHealthScanSlotCount = 6/);
  assert.match(coordinator, /AudioHealthScanSlotDue/);
  assert.match(coordinator, /TryClaimAudioHealthScanSlot/);
  assert.match(coordinator, /gAudioHealthScanInProgress/);
  assert.match(coordinator, /kAudioHealthScanMinimumGapMs = 4ULL \* 1000ULL/);
  assert.match(coordinator, /ReleaseAudioHealthScan/);
  assert.match(profilePolicy, /TryClaimAudioHealthScan\(now\)[\s\S]*TryClaimAudioHealthScanSlot/);
  assert.match(profilePolicy, /kAudioHealthScanRetryMs[\s\S]*StationheadProfileAudioHealthRetryMs/);
  assert.match(stationheadRecovery,
    /StationheadAudioHealthCheckIntervalMs\(\) noexcept[\s\S]*return 1 \* 60'000;/);
});

test('Stationhead one-minute scheduler observes audio only in the profile slot', () => {
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

test('Stationhead does not use the retired preventive refresh implementation', () => {
  assert.doesNotMatch(stationheadRecovery, /StationheadPeriodicRefreshIntervalMs/);
  assert.doesNotMatch(stationheadRecovery, /RefreshPeriodicNavigation/);
  assert.doesNotMatch(stationheadRecovery, /50-minute periodic refresh/);
});
