import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);
const policySource = readFileSync(
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

test('52-minute eligibility subtracts the monotonic proxy instead of wall time', () => {
  assert.match(
    playerSource,
    /nowMs - lastReloadAt_ < kStationheadTrackBoundaryRefreshDelayMs/,
  );

  const subtraction = section(
    policySource,
    'friend int64_t operator-(',
    'private:',
  );
  assert.match(subtraction, /GetTickCount64\(\)/);
  assert.match(
    subtraction,
    /StationheadBoundaryElapsedMs\(monotonicAt, GetTickCount64\(\)\)/,
  );
});

test('accepted baselines capture independent monotonic ticks for A and B', () => {
  assert.match(policySource, /primaryReloadMonotonicAt = 0;/);
  assert.match(policySource, /secondaryReloadMonotonicAt = 0;/);

  const assignment = section(
    policySource,
    'int64_t operator=(int64_t candidate) noexcept',
    'friend int64_t operator-(',
  );
  assert.match(
    assignment,
    /secondary_[\s\S]*secondaryReloadMonotonicAt[\s\S]*primaryReloadMonotonicAt/,
  );
  assert.match(assignment, /if \(accept\) monotonicAt = GetTickCount64\(\);/);
  assert.ok(
    assignment.indexOf('if (accept) storage_ = candidate;') <
      assignment.indexOf('if (accept) monotonicAt = GetTickCount64();'),
    'the diagnostic UTC baseline and monotonic baseline must advance together',
  );
});

test('elapsed helper clamps invalid backwards samples instead of forcing refresh', () => {
  const elapsed = section(
    policySource,
    'inline constexpr int64_t StationheadBoundaryElapsedMs(',
    'static_assert(IsStationheadBoundaryReadyMessage',
  );
  assert.match(elapsed, /startedAt == 0 \|\| now < startedAt/);
  assert.match(elapsed, /return 0;/);
  assert.match(elapsed, /kMaxSignedMilliseconds/);
  assert.match(
    policySource,
    /static_assert\(StationheadBoundaryElapsedMs\(4'120, 1'000\) == 0\);/,
  );
});

test('civil clock values remain diagnostic-only after a baseline exists', () => {
  const subtraction = section(
    policySource,
    'friend int64_t operator-(',
    'private:',
  );
  const fallbackAt = subtraction.indexOf(
    'if (monotonicAt == 0) return wallClockNow - clock.storage_;',
  );
  const monotonicAt = subtraction.indexOf(
    'return StationheadBoundaryElapsedMs(monotonicAt, GetTickCount64());',
  );
  assert.notEqual(fallbackAt, -1);
  assert.notEqual(monotonicAt, -1);
  assert.ok(
    fallbackAt < monotonicAt,
    'wall time may only be used before a monotonic baseline has been established',
  );
});
