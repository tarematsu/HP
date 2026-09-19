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

test('single long-lived room uses one-minute native audio health without preventive navigation', () => {
  assert.match(policy, /StationheadAudioHealthCheckIntervalMs\(\) noexcept[\s\S]*return 1 \* 60'000;/);
  const wake = section(policy, '#define NextWakeAt()', '#define RecoverUnavailableAuthorization()');
  assert.match(wake, /audioHealthCheckStartedAt_/);
  assert.match(wake, /StationheadAudioHealthCheckIntervalMs\(\)/);
  assert.match(wake, /audioLossRecoveryStartedAt_/);
  assert.match(wake, /StationheadAudioRecoverySettleMs\(\)/);
  assert.match(policy, /AudioHealthScanDelayMs\(GetTickCount64\(\), 0\)/);
  assert.match(policy, /TryClaimAudioHealthScan\(scanTick\)/);
  assert.match(policy, /const int64_t nowMs = UnixMillis\(\)/);
  assert.match(policy, /PollPeriodicAudioHealth\(nowMs\)/);
  assert.doesNotMatch(policy, /StationheadPeriodicRefreshIntervalMs/);
  assert.doesNotMatch(policy, /RefreshPeriodicNavigation/);
  assert.doesNotMatch(policy, /50-minute periodic refresh/);
});

test('page-side track-boundary polling stays removed', () => {
  const script = section(trackScript, 'inline std::wstring StationheadTrackBoundaryScript(',
    '}  // namespace hp');
  assert.match(script, /return L"void 0;"/);
  assert.doesNotMatch(script, /timeupdate|setInterval|MutationObserver|track-ended/);
});

test('App keeps exactly one Stationhead scheduler', () => {
  assert.match(app, /stationhead_->NextWakeAt\(\)/);
  assert.doesNotMatch(app, /UpdateStationheadPlaybackFallback|ApplyScheduledStationheadAudioProfile/);
});
