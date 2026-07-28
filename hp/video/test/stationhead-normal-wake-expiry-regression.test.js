import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playerHeader = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url),
  'utf8',
);
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);
const clockPolicy = readFileSync(
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

test('expired ordinary player wake uses a fresh clock read after projection', () => {
  const wakePolicy = section(
    clockPolicy,
    'inline int64_t StationheadPolicyWallMillis()',
    'inline bool operator>(',
  );
  const projectionAt = wakePolicy.indexOf(
    'const int64_t projected = static_cast<int64_t>(deadline);',
  );
  const freshNowAt = wakePolicy.indexOf(
    'projected > StationheadPolicyWallMillis()',
  );
  assert.ok(projectionAt >= 0 && freshNowAt > projectionAt);
  assert.match(wakePolicy, /GetSystemTimeAsFileTime\(&fileTime\)/);
  assert.match(wakePolicy, /projected > 0/);
  assert.doesNotMatch(wakePolicy, /UnixMillis\(/);
  assert.match(
    wakePolicy,
    /operator<\([\s\S]*const StartupAwareWakeDeadline& deadline[\s\S]*StationheadStartupAwareWakePending\(deadline\)/,
  );
});

test('normal Tick gate binds to the StartupAware wake overload', () => {
  const tick = section(
    playerSource,
    'void StationheadPlayer::Tick(int64_t nowMs)',
    'void StationheadPlayer::Reconnect()',
  );
  assert.match(tick, /if \(nowMs < nextTickAt_/);
  assert.match(
    playerHeader,
    /class StartupAwareWakeDeadline[\s\S]*MonotonicProjectedDeadline value_;/,
  );
  assert.match(
    clockPolicy,
    /operator<\(\s*int64_t, const StartupAwareWakeDeadline& deadline\)/,
  );
});

test('startup watchdogs still bypass the ordinary wake gate', () => {
  const wake = section(
    playerHeader,
    'class StartupAwareWakeDeadline',
    'struct StationheadDailyPlayPoint',
  );
  assert.match(wake, /startupWatchdogPending \? 0 : static_cast<int64_t>\(value_\)/);
  assert.match(
    clockPolicy,
    /return projected > 0 && projected > StationheadPolicyWallMillis\(\);/,
  );
});
