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

test('live DOM interaction state remains independent from audio settlement', () => {
  const wrapper = section(
    policy,
    '#define RecoverUnavailableAuthorization()',
    '#define RetryPendingTrackBoundaryRefresh',
  );
  const bridge = section(
    policy,
    'inline std::wstring StationheadAutoplayScriptCurrentInteraction(',
    '#define kStationheadPostPlaybackStopClickDelayMs',
  );

  assert.doesNotMatch(policy, /SettleStaleInteractivePlayback/);
  assert.doesNotMatch(wrapper, /AudioPlaying\(\).*loginRequired_/);
  assert.match(bridge, /__homepanelStationheadBlockingLoginVisible/);
  assert.match(bridge, /blocking !== true && blocking !== false/);
  assert.match(bridge, /if \(!blocking\)/);
  assert.match(bridge, /type: 'stationhead-auth-ready'/);
  assert.match(bridge, /source: 'current-interaction-state'/);
});

test('50-minute refresh has one direct interactive-state gate', () => {
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');

  assert.match(
    injected,
    /spotifyAuthorization_ \|\| loginRequired_ \|\|[\s\S]*recreating_/,
  );
  assert.doesNotMatch(injected, /unresolvedInteractiveLogin/);
  assert.match(policy, /return 50 \* 60'000;/);
  assert.match(injected, /L"50-minute periodic refresh"/);
});
