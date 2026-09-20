import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const timingHeader = source('monotonic_time.h');
const playerSource = source('sh.cpp');
const layoutSource = source('sh_layout.cpp');

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('delayed WebView recreation keeps the App scheduler on a fast wake', () => {
  const wake = section(
    timingHeader,
    'class StartupAwareWakeDeadline',
    '}  // namespace hp',
  );
  assert.match(wake, /recreating_->load\(std::memory_order_relaxed\)/);
  assert.match(wake, /startupWatchdogPending \? 0 : static_cast<int64_t>\(value_\)/);
  assert.match(wake, /MonotonicProjectedDeadline value_;/);
});

test('earliest recreate request is compared in monotonic uptime space', () => {
  const deadline = section(
    timingHeader,
    'class MonotonicDeadline',
    'class MonotonicProjectedDeadline',
  );
  assert.match(deadline, /TickForWallDeadline\(candidateWallDeadline\)/);
  assert.match(deadline, /current\.deadlineTick_/);
  const schedule = section(playerSource, 'void StationheadPlayer::ScheduleRecreate(', '}  // namespace hp');
  assert.match(schedule, /candidate < recreateAt_/);
});

test('pending Spotify auth creation coalesces repeated controller requests', () => {
  const ensureAuthHost = section(
    layoutSource, 'bool StationheadPlayer::EnsureAuthHostWindow() {',
    'void StationheadPlayer::KeepPlaybackBehindDashboard()');
  assert.ok(
    ensureAuthHost.indexOf('authControllerStartedAt_.Active() && !authController_') >= 0 &&
    ensureAuthHost.indexOf('authControllerStartedAt_.Active() && !authController_') <
      ensureAuthHost.indexOf('authHostWindow_ && IsWindow(authHostWindow_)'),
  );
  assert.match(playerSource, /authPendingUrl_ = url;/);
});
