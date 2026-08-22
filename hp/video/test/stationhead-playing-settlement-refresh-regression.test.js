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

test('confirmed audio settles a stale login foreground for either Stationhead role', () => {
  const wrapper = section(
    policy,
    '#define RecoverUnavailableAuthorization()',
    '#define RetryPendingTrackBoundaryRefresh',
  );
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');

  assert.match(wrapper, /SettleStaleInteractivePlayback\(\);/);
  assert.match(injected, /void SettleStaleInteractivePlayback\(\)/);
  assert.match(injected, /!AudioPlaying\(\) \|\| spotifyAuthorization_ \|\| !loginRequired_/);
  assert.match(injected, /loginRequired_ = false;/);
  assert.match(injected, /status_\.loginRequired = false;/);
  assert.match(injected, /SelectTab\(StationheadTabKind::None\);/);
  assert.match(injected, /PostChange\(StationheadChangeReturnMain\);/);
  assert.doesNotMatch(injected, /IsSecondary\(\).*SettleStaleInteractivePlayback/);
});

test('53/54-minute refresh is blocked only by unresolved interactive login', () => {
  const injected = section(policy, '#define nextAutoClickAt_', '#include "sh.h"');

  assert.match(injected, /const bool unresolvedInteractiveLogin = loginRequired_ && !AudioPlaying\(\);/);
  assert.match(
    injected,
    /spotifyAuthorization_ \|\| unresolvedInteractiveLogin \|\|[\s\S]*recreating_/,
  );
  assert.doesNotMatch(
    injected,
    /spotifyAuthorization_ \|\| loginRequired_ \|\|/,
  );
  assert.match(policy, /secondary \? 54 : 53/);
  assert.match(injected, /L"54-minute periodic refresh"/);
  assert.match(injected, /L"53-minute periodic refresh"/);
});
