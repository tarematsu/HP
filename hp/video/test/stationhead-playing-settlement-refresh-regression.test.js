import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const policy = readFileSync(
  new URL('../../native/src/sh_track_boundary_message_policy.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('A and B use the live DOM interaction state instead of an audio settlement latch', () => {
  const wrapper = section(
    policy,
    '#define RecoverUnavailableAuthorization()',
    '#define RetryPendingTrackBoundaryRefresh',
  );
  const bridge = section(
    policy,
    'inline std::wstring StationheadAutoplayScriptCurrentInteraction(',
    '// Window B no longer asks Stationhead',
  );

  assert.doesNotMatch(policy, /SettleStaleInteractivePlayback/);
  assert.doesNotMatch(wrapper, /AudioPlaying\(\).*loginRequired_/);
  assert.match(bridge, /__homepanelStationheadBlockingLoginVisible/);
  assert.match(bridge, /blocking !== true && blocking !== false/);
  assert.match(bridge, /if \(!blocking\)/);
  assert.match(bridge, /type: 'stationhead-auth-ready'/);
  assert.match(bridge, /source: 'current-interaction-state'/);
  assert.match(
    policy,
    /#define StationheadAutoplayScript StationheadAutoplayScriptCurrentInteraction/,
  );
});

test('Window B legacy auth probe is local-only and shares the same interaction state', () => {
  const probe = section(
    policy,
    'inline std::wstring StationheadCurrentInteractionAuthProbeScript(',
    'inline constexpr int64_t kStationheadMeasuredPostPlaybackStopClickDelayMs',
  );

  assert.match(probe, /__homepanelStationheadBlockingLoginVisible === true/);
  assert.match(probe, /post\(\{ type: 'stationhead-auth-probe'/);
  assert.match(probe, /blocking \? 'auth-failed' : 'ok'/);
  assert.doesNotMatch(probe, /fetch\s*\(/);
  assert.doesNotMatch(probe, /production1\.stationhead\.com|streakStats/);
  assert.match(
    policy,
    /#define StationheadAuthProbeScript StationheadCurrentInteractionAuthProbeScript/,
  );
});

test('53/54-minute refresh has one direct interactive-state gate', () => {
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');

  assert.match(
    injected,
    /spotifyAuthorization_ \|\| loginRequired_ \|\|[\s\S]*recreating_/,
  );
  assert.doesNotMatch(injected, /unresolvedInteractiveLogin/);
  assert.match(policy, /secondary \? 54 : 53/);
  assert.match(injected, /L"54-minute periodic refresh"/);
  assert.match(injected, /L"53-minute periodic refresh"/);
});
