import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const config = source('config.h');
const cloudConfig = source('cloud_config.cpp');
const app = source('app.cpp');
const player = source('sh.h');
const route = source('stationhead_daily_route.h');
const policy = source('sh_track_boundary_message_policy.h');
const audioLossPolicy = source('sh_audio_loss_policy.h');
const trackScript = source('sh_track_boundary_script.h');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('native schedule owns Stationhead destinations', () => {
  assert.match(config, /url = L"https:\/\/www\.stationhead\.com\/sakuramankai"/);
  assert.match(config, /std::wstring fallbackUrl;/);
  assert.match(cloudConfig, /kCanonicalPrimaryStationheadUrl\[\] =[\s\S]*L"https:\/\/www\.stationhead\.com\/sakuramankai"/);
  assert.match(cloudConfig, /config\.stationhead\.fallbackUrl\.clear\(\)/);
  assert.doesNotMatch(cloudConfig, /kCanonicalFallbackStationheadUrl/);

  assert.match(route, /23 \* 60 \+ 45[\s\S]*https:\/\/www\.stationhead\.com\/c\/ohisama/);
  assert.match(route, /11 \* 60 \+ 45[\s\S]*12 \* 60 \+ 15[\s\S]*https:\/\/www\.stationhead\.com\/c\/unity/);
  assert.match(route, /return L"https:\/\/www\.stationhead\.com\/sakuramankai"/);
  assert.match(player, /StationheadNextRouteChangeAt\(UnixMillis\(\) - routeDelayMs_\) \+ routeDelayMs_/);
});

test('Stationhead has no preventive periodic reload; scheduled room changes only wake routing', () => {
  const wake = section(policy, '#define NextWakeAt()', '#define RecoverUnavailableAuthorization()');
  assert.doesNotMatch(policy, /StationheadScheduledReload|scheduledReload|stationhead_scheduled_reload/);
  assert.doesNotMatch(wake, /Reload/);
  assert.match(player, /StationheadNextRouteChangeAt/);
});

test('one-minute native audio health and loss recovery remain active', () => {
  assert.match(policy, /StationheadAudioHealthCheckIntervalMs\(\) noexcept[\s\S]*return 1 \* 60'000;/);
  assert.match(audioLossPolicy, /kStationheadAudioLossGraceMs = 120'000/);
  const wake = section(policy, '#define NextWakeAt()', '#define RecoverUnavailableAuthorization()');
  assert.match(wake, /audioHealthCheckStartedAt_/);
  assert.match(wake, /StationheadAudioHealthCheckIntervalMs\(\)/);
  assert.match(wake, /audioLossRecoveryStartedAt_/);
  assert.match(wake, /StationheadAudioRecoverySettleMs\(\)/);
  assert.match(policy, /AudioHealthScanDelayMs\(GetTickCount64\(\), 0\)/);
  assert.match(policy, /TryClaimAudioHealthScan\(scanTick\)/);
  assert.match(policy, /const int64_t nowMs = UnixMillis\(\)/);
  assert.match(policy, /PollPeriodicAudioHealth\(nowMs\)/);
  assert.match(policy, /NavigateCurrentUrl\(nowMs, L"audio-loss recovery reload"\)/);
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
  assert.match(app, /SetRouteDelayMinutes\(static_cast<int>\(i\)\)/);
  assert.match(app, /SetRouteDelayMinutes\(5\)/);
  assert.doesNotMatch(app, /UpdateStationheadPlaybackFallback|ApplyScheduledStationheadAudioProfile/);
});
