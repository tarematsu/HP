import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const config = source('config.h');
const cloudConfig = source('cloud_config.cpp');
const app = source('app.cpp');
const policy = source('sh_track_boundary_message_policy.h');
const trackScript = source('sh_track_boundary_script.h');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('primary room and fallback URLs remain configured', () => {
  assert.match(config, /url = L"https:\/\/www\.stationhead\.com\/sakuramankai"/);
  assert.match(config, /fallbackUrl = L"https:\/\/www\.stationhead\.com\/buddy46"/);
  assert.match(cloudConfig, /kCanonicalPrimaryStationheadUrl/);
  assert.match(cloudConfig, /kCanonicalFallbackStationheadUrl/);
});

test('Stationhead reload cadence is anchored to app startup and staggered by profile', () => {
  assert.match(policy, /StationheadScheduledReloadIntervalMs\(\) noexcept[\s\S]*return 50 \* 60'000;/);
  assert.match(policy, /StationheadScheduledReloadStaggerMs\(\) noexcept[\s\S]*return 5 \* 60'000;/);
  assert.match(policy, /StationheadScheduledReloadFirstBaseMs\(\) noexcept[\s\S]*return 20 \* 60'000;/);
  assert.match(policy, /kPrefix\[\] = L"spotify-v2-"/);
  assert.match(policy, /suffix >= L'1' && suffix <= L'6'/);
  assert.match(policy, /stationhead_scheduled_reload[\s\S]*appStartTick/);
  assert.match(policy, /StationheadScheduledReloadFirstDelayMs\(profileName_\)/);
  assert.match(policy, /scheduledReloadNextTick_[\s\S]*appStartTick/);
  assert.match(policy, /AdvanceScheduledReloadAfter\(nowTick\)/);
  assert.match(policy, /NavigateCurrentUrl\(nowMs, L"scheduled Stationhead 50-minute reload"\)/);
});

test('scheduled reload participates in wake scheduling and waits for safe navigation state', () => {
  const wake = section(policy, '#define NextWakeAt()', '#define RecoverUnavailableAuthorization()');
  assert.match(wake, /scheduledReloadNextTick_/);
  assert.match(wake, /scheduledReloadRetryTick_/);
  assert.match(wake, /StationheadScheduledReloadProjectedWallDeadline/);

  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.match(injected, /void PollScheduledReload\(int64_t nowMs\)/);
  assert.match(injected, /spotifyAuthorization_ \|\| loginRequired_ \|\| navigationActive/);
  assert.match(injected, /creating_\.load\(std::memory_order_relaxed\)/);
  assert.match(injected, /recreating_\.load\(std::memory_order_relaxed\)/);
  assert.match(injected, /recoveryActive/);
  assert.match(injected, /kRetryDelayMs = 15'000/);
});

test('one-minute native audio health remains active beside scheduled reloads', () => {
  assert.match(policy, /StationheadAudioHealthCheckIntervalMs\(\) noexcept[\s\S]*return 1 \* 60'000;/);
  const wake = section(policy, '#define NextWakeAt()', '#define RecoverUnavailableAuthorization()');
  assert.match(wake, /audioHealthCheckStartedAt_/);
  assert.match(wake, /StationheadAudioHealthCheckIntervalMs\(\)/);
  assert.match(wake, /audioLossRecoveryStartedAt_/);
  assert.match(wake, /StationheadAudioRecoverySettleMs\(\)/);
  assert.match(policy, /AudioHealthScanDelayMs\(GetTickCount64\(\), 0\)/);
  assert.match(policy, /TryClaimAudioHealthScan\(scanTick\)/);
  assert.match(policy, /const int64_t nowMs = UnixMillis\(\)/);
  assert.match(policy, /PollScheduledReload\(nowMs\)/);
  assert.match(policy, /PollPeriodicAudioHealth\(nowMs\)/);
});

test('page-side track-boundary polling stays removed', () => {
  const script = section(trackScript, 'inline std::wstring StationheadTrackBoundaryScript(',
    '}  // namespace hp');
  assert.match(script, /return L"void 0;"/);
  assert.doesNotMatch(script, /timeupdate|setInterval|MutationObserver|track-ended/);
});

test('App schedules every Stationhead handle independently', () => {
  assert.match(app, /stationheadPeers_\[i\]->NextWakeAt\(\)/);
  assert.match(app, /stationhead_->NextWakeAt\(\)/);
  assert.match(app, /stationheadPeers_\[i\]->Tick\(now\)/);
  assert.match(app, /stationhead_->Tick\(now\)/);
  assert.doesNotMatch(app, /UpdateStationheadPlaybackFallback|ApplyScheduledStationheadAudioProfile/);
});
