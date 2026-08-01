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
const sharedSource = readFileSync(
  new URL('../../native/src/sh_shared.h', import.meta.url),
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

test('Start Listening retry deadlines are retained per Stationhead role', () => {
  assert.match(
    clockPolicy,
    /inline MonotonicProjectedDeadline primaryAutoClickDeadline;/,
  );
  assert.match(
    clockPolicy,
    /inline MonotonicProjectedDeadline secondaryAutoClickDeadline;/,
  );
  assert.match(clockPolicy, /primaryAutoClickExposed = 0;/);
  assert.match(clockPolicy, /secondaryAutoClickExposed = 0;/);
});

test('auto-click lvalue storage synchronizes external writes into uptime', () => {
  const proxy = section(
    clockPolicy,
    'inline int64_t& StationheadAutoClickDeadlineStorage(',
    'class StationheadBoundaryReloadClockProxy',
  );
  assert.match(proxy, /if \(storage != exposed\) deadline = storage;/);
  assert.match(proxy, /storage = StationheadProjectedDeadlineValue\(deadline\);/);
  assert.match(proxy, /exposed = storage;/);
  assert.match(proxy, /return storage;/);
});

test('the final PCH alias preserves the existing nextAutoClickAt lvalue API', () => {
  assert.match(playerHeader, /int64_t nextAutoClickAt_ = 0;/);
  assert.match(
    clockPolicy,
    /#define nextAutoClickAt_[\s\S]*StationheadAutoClickDeadlineStorage[\s\S]*\(nextAutoClickAt_\), IsSecondary\(\)/,
  );
});

test('the legacy 12-second stop delay is replaced by the measured 3.5-second value', () => {
  assert.match(
    sharedSource,
    /kStationheadPostPlaybackStopClickDelayMs\s*=\s*12'000/,
    'the source declaration remains available to older policy layers',
  );
  assert.match(clockPolicy, /#include "sh_shared.h"/);
  assert.match(
    clockPolicy,
    /kStationheadMeasuredPostPlaybackStopClickDelayMs\s*=\s*\n\s*3'500/,
  );
  assert.match(
    clockPolicy,
    /#define kStationheadPostPlaybackStopClickDelayMs[\s\S]*kStationheadMeasuredPostPlaybackStopClickDelayMs/,
  );
  assert.match(
    clockPolicy,
    /static_assert\(kStationheadMeasuredPostPlaybackStopClickDelayMs < 12'000\);/,
  );
});

test('all Start Listening delay paths continue through the routed deadline', () => {
  assert.match(
    playerSource,
    /nextAutoClickAt_ = UnixMillis\(\) \+ kStationheadPostPlaybackStopClickDelayMs/,
  );
  assert.match(
    playerSource,
    /nowMs < nextAutoClickAt_[\s\S]*nextAutoClickAt_ = nowMs \+ kStationheadAutoClickRetryMs/,
  );
  assert.match(
    playerSource,
    /nextAutoClickAt_ = std::max\([\s\S]*nextAutoClickAt_[\s\S]*UnixMillis\(\) \+ kStationheadAutoClickSuccessGraceMs/,
  );
  assert.match(playerSource, /nowMs >= nextAutoClickAt_/);
  assert.match(playerSource, /consider\(nextAutoClickAt_\);/);
});
