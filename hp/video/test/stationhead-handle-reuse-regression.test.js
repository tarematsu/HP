import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handleHeader = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url),
  'utf8',
);
const handleSource = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('fresh player assignment cannot inherit a stale startup preview', () => {
  const assign = section(
    handleSource,
    'void StationheadHandleBase::AssignPlayer(',
    'void StationheadHandleBase::ResetPlayer()',
  );
  assert.match(assign, /startupPreviewBounds_ = RECT\{0, 0, 1, 1\};/);
  assert.match(assign, /startupPreviewActive_ = false;/);
  assert.ok(assign.indexOf('startupPreviewActive_ = false;') < assign.indexOf('player_ = std::move(player);'));

  const reset = section(
    handleSource,
    'void StationheadHandleBase::ResetPlayer()',
    'bool StationheadHandleBase::HasAuthTabPlayer()',
  );
  assert.match(reset, /startupPreviewBounds_ = RECT\{0, 0, 1, 1\};/);
  assert.match(reset, /startupPreviewActive_ = false;/);
});

test('primary handle teardown releases startup coordination state', () => {
  const primary = section(
    handleHeader,
    'class AppStationheadHandle final',
    'class AppSecondaryStationheadHandle final',
  );
  assert.match(primary, /void Stop\(\) \{[\s\S]*ResetStartupPreviewState\(\);/);
  assert.match(primary, /StartupPrimaryHandle\(\) == this[\s\S]*SetStartupPrimaryHandle\(nullptr\)/);
  assert.match(primary, /requestedStartupPreviewBounds_ = RECT\{0, 0, 1, 1\};/);
  assert.match(primary, /startupPreviewRequested_ = false;/);

  assert.match(
    handleSource,
    /AppStationheadHandle::~AppStationheadHandle\(\) \{[\s\S]*ResetStartupPreviewState\(\);/,
  );
  assert.match(
    handleSource,
    /AppStationheadHandle::operator=\([\s\S]*ResetStartupPreviewState\(\);[\s\S]*AssignPlayer/,
  );
  assert.match(
    handleSource,
    /void AppStationheadHandle::reset\(\) noexcept \{[\s\S]*ResetStartupPreviewState\(\);[\s\S]*ResetPlayer/,
  );
});

test('secondary teardown restores A before discarding an unexposed B preview', () => {
  const secondary = section(
    handleHeader,
    'class AppSecondaryStationheadHandle final',
    '}  // namespace hp',
  );
  const reset = section(
    secondary,
    '  void ResetDeferredStartupState(bool restorePrimary) noexcept {',
    '  void TryStartDeferred()',
  );
  assert.match(reset, /restorePrimary && startupPreviewRequested_ && !startupPreviewApplied_/);
  assert.match(reset, /primary->RestoreRequestedStartupPreviewBounds\(\);/);
  assert.match(reset, /pendingStartupPreviewBounds_ = RECT\{0, 0, 1, 1\};/);
  assert.match(reset, /startupRequestedAtTick_ = 0;/);
  assert.match(reset, /startupPreviewRequested_ = false;/);
  assert.match(reset, /startupPreviewApplied_ = false;/);
  assert.match(secondary, /void ClearStartupPreviewBounds\(\) \{[\s\S]*ResetDeferredStartupState\(true\);/);
  assert.match(secondary, /void Stop\(\) \{[\s\S]*ResetDeferredStartupState\(true\);/);

  for (const signature of [
    'AppSecondaryStationheadHandle::~AppSecondaryStationheadHandle()',
    'AppSecondaryStationheadHandle::operator=(',
    'void AppSecondaryStationheadHandle::reset() noexcept',
  ]) {
    const at = handleSource.indexOf(signature);
    assert.notEqual(at, -1, `missing method: ${signature}`);
    assert.match(handleSource.slice(at, at + 500), /ResetDeferredStartupState\(true\);/);
  }
});
