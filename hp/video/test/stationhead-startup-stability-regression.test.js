import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handleHeader = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('App requests Window A before Window B during cold startup', () => {
  const startServices = section(
    appSource,
    'void App::StartServices()',
    'void App::ApplyStartupStationheadPreview()',
  );
  const primaryStart = startServices.indexOf('stationhead_->Start();');
  const secondaryStart = startServices.indexOf('secondaryStationhead_->Start();');
  assert.ok(primaryStart >= 0 && secondaryStart > primaryStart);
});

test('Window B defers its actual player start until Window A is configured', () => {
  const secondaryHandle = section(
    handleHeader,
    'class AppSecondaryStationheadHandle final',
    '}  // namespace hp',
  );
  const start = section(
    secondaryHandle,
    '  void Start() {',
    '  void Tick(int64_t nowMs) {',
  );
  assert.match(start, /const uint64_t nowTick = GetTickCount64\(\);/);
  assert.match(start, /startupRequestedAtTick_ = nowTick == 0 \? 1 : nowTick;/);
  assert.match(start, /TryStartDeferred\(\);/);
  assert.doesNotMatch(start, /StationheadHandleBase::Start\(\)/);

  const deferred = section(
    secondaryHandle,
    '  void TryStartDeferred() {',
    '  uint64_t startupRequestedAtTick_',
  );
  assert.match(deferred, /StationheadHandleBase\* primary = StartupPrimaryHandle\(\);/);
  assert.match(deferred, /primary && primary->RawStatus\(\)\.created/);
  assert.match(deferred, /SecondaryStationheadStartupReady\(/);
  assert.match(deferred, /StationheadHandleBase::Start\(\);/);
});

test('startup coordination remains private to the handle lifecycle', () => {
  const baseHandle = section(
    handleHeader,
    'class StationheadHandleBase',
    'class AppStationheadHandle final',
  );
  assert.match(baseHandle, /inline static StationheadHandleBase\* startupPrimaryHandle_ = nullptr;/);
  assert.match(baseHandle, /SetStartupPrimaryHandle\(/);
  assert.match(baseHandle, /StartupPrimaryHandle\(\)/);
  assert.doesNotMatch(handleHeader, /inline StationheadHandleBase\* stationheadStartupPrimaryHandle/);
});

test('Window B startup fallback uses monotonic uptime instead of wall clock', () => {
  assert.match(
    handleHeader,
    /kStationheadSecondaryStartupFallbackMs = 8'000/,
  );
  const readiness = section(
    handleHeader,
    'inline constexpr bool SecondaryStationheadStartupReady(',
    'enum class WorkspaceTab',
  );
  assert.match(readiness, /nowTick >= requestedAtTick/);
  assert.match(
    readiness,
    /nowTick - requestedAtTick >= kStationheadSecondaryStartupFallbackMs/,
  );
  assert.doesNotMatch(readiness, /UnixMillis/);
});

test('deferred Window B starts and ticks in one scheduler pass', () => {
  const secondaryHandle = section(
    handleHeader,
    'class AppSecondaryStationheadHandle final',
    '}  // namespace hp',
  );
  const tick = section(
    secondaryHandle,
    '  void Tick(int64_t nowMs) {',
    '  void Stop() {',
  );
  const startAt = tick.indexOf('TryStartDeferred();');
  const tickAt = tick.indexOf('StationheadHandleBase::Tick(nowMs);');
  assert.ok(startAt >= 0 && tickAt > startAt);
  assert.match(tick, /if \(PlayerStarted\(\)\)/);
});

test('shutdown cancels a pending Window B startup request', () => {
  const secondaryHandle = section(
    handleHeader,
    'class AppSecondaryStationheadHandle final',
    '}  // namespace hp',
  );
  const stop = section(
    secondaryHandle,
    '  void Stop() {',
    '  StationheadStatus Status() const',
  );
  const clearAt = stop.indexOf('startupRequestedAtTick_ = 0;');
  const stopAt = stop.indexOf('StationheadHandleBase::Stop();');
  assert.ok(clearAt >= 0 && stopAt > clearAt);
});
