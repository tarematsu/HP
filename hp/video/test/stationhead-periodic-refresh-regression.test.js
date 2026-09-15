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

test('player periodic refresh clock is native-owned and fixed at 50 minutes', () => {
  assert.match(policy, /return 50 \* 60'000/);
  assert.match(policy, /StationheadPeriodicRefreshIntervalMs\(false\) == 50 \* 60'000/);
  assert.match(policy, /StationheadPeriodicRefreshIntervalMs\(true\) == 50 \* 60'000/);
  const wake = section(policy, '#define NextWakeAt()', '#define RecoverUnavailableAuthorization()');
  assert.match(wake, /periodicRefreshStartedAt_/);
  assert.match(wake, /StationheadPeriodicRefreshIntervalMs\(IsSecondary\(\)\)/);
  const refresh = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');
  assert.match(refresh, /audioPlayingSinceAt_\.store\(0, std::memory_order_relaxed\)/);
  assert.match(refresh, /audioLossPlaybackObserved_ = false/);
  assert.match(refresh, /SetStartupBounds\(\)/);
  assert.match(refresh, /L"50-minute periodic refresh"/);
  assert.match(policy, /RefreshPeriodicNavigation\(UnixMillis\(\)\)/);
  assert.match(policy, /NavigateCurrentUrl\(/);
});

test('page-side track-boundary polling stays removed', () => {
  const script = section(trackScript, 'inline std::wstring StationheadTrackBoundaryScript(',
    '}  // namespace hp');
  assert.match(script, /return L"void 0;"/);
  assert.doesNotMatch(script, /timeupdate|setInterval|MutationObserver|track-ended/);
});

test('single App has no cross-window fallback scheduler', () => {
  assert.doesNotMatch(app,
    /UpdateStationheadPlaybackFallback|secondaryStationhead_|ApplyScheduledStationheadAudioProfile/);
});
