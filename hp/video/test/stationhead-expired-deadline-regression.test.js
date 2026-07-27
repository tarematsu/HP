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

test('expired projected deadlines retain an unambiguous reached value', () => {
  const projection = section(
    policy,
    'inline constexpr int64_t StationheadOperationalDeadlineValue(',
    'inline int64_t StationheadProjectedDeadlineValue(',
  );
  assert.match(projection, /if \(!active\) return 0;/);
  assert.match(projection, /return reached \? 1 : projectedWallDeadline;/);
  assert.match(
    policy,
    /static_assert\(StationheadOperationalDeadlineValue\(true, true, 42\) == 1\);/,
  );
});

test('Tick-local comparisons query monotonic reachability directly', () => {
  assert.match(
    policy,
    /operator>=\([\s\S]*const MonotonicProjectedDeadline& deadline[\s\S]*return deadline\.Reached\(\);/,
  );
  assert.match(
    policy,
    /operator<\([\s\S]*int64_t,[\s\S]*const MonotonicProjectedDeadline& deadline[\s\S]*deadline\.Active\(\) && !deadline\.Reached\(\)/,
  );
  assert.match(
    policy,
    /operator>\([\s\S]*const MonotonicProjectedDeadline& deadline, int64_t candidate[\s\S]*candidate == 0[\s\S]*deadline\.Active\(\)/,
  );
  assert.match(
    policy,
    /operator<=\([\s\S]*const MonotonicProjectedDeadline& deadline, int64_t candidate[\s\S]*candidate == 0[\s\S]*!deadline\.Active\(\)/,
  );
});

test('Start Listening proxy exposes reached rather than moving wall time', () => {
  const proxy = section(
    policy,
    'inline int64_t& StationheadAutoClickDeadlineStorage(',
    'class StationheadBoundaryReloadClockProxy',
  );
  assert.match(proxy, /if \(storage != exposed\) deadline = storage;/);
  assert.match(proxy, /storage = StationheadProjectedDeadlineValue\(deadline\);/);
  assert.doesNotMatch(proxy, /storage = static_cast<int64_t>\(deadline\);/);
});
