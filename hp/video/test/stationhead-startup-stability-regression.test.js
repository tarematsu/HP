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

function assertOrdered(source, markers) {
  let previous = -1;
  for (const marker of markers) {
    const at = source.indexOf(marker);
    assert.ok(at >= 0, `missing marker: ${marker}`);
    assert.ok(at > previous, `out-of-order marker: ${marker}`);
    previous = at;
  }
}

test('native dashboard is initialized before the top-level window is exposed', () => {
  const startServices = section(
    appSource,
    'void App::StartServices()',
    'void App::ApplyStartupStationheadPreview()',
  );
  assertOrdered(startServices, [
    'renderer_->Initialize();',
    'rendererStarted_ = true;',
    'LayoutWorkspace();',
    'renderer_->TickNativePanels(startupAt_);',
    'Native dashboard started before main window display',
    'stationhead_->Start();',
    'ShowWindow(window_, startupShowCommand_);',
  ]);
  assert.doesNotMatch(startServices, /ApplyStartupStationheadPreview\(\)/);
});

test('legacy Stationhead workspace cannot hide the dashboard', () => {
  const layoutWorkspace = section(
    appSource,
    'void App::LayoutWorkspace()',
    'void App::ApplyStationheadWindowPlacement(',
  );
  assert.match(
    layoutWorkspace,
    /if \(selectedTab_ == WorkspaceTab::Stationhead\) \{[\s\S]*selectedTab_ = WorkspaceTab::Main;/,
  );
  assert.match(layoutWorkspace, /renderer_->SetVisible\(rendererStarted_\);/);
  assert.doesNotMatch(
    layoutWorkspace,
    /renderer_->SetVisible\(rendererStarted_ && selectedTab_ == WorkspaceTab::Main\)/,
  );
});

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
    '  void ApplyDeferredStartupPreview() {',
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
    'inline bool StationheadStartupPreviewReady(',
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
  const previewAt = tick.indexOf('ApplyDeferredStartupPreview();');
  assert.ok(startAt >= 0 && tickAt > startAt && previewAt > tickAt);
  assert.match(tick, /if \(PlayerStarted\(\)\)/);
});

test('Window A covers both preview halves while Window B is deferred', () => {
  const primaryHandle = section(
    handleHeader,
    'class AppStationheadHandle final',
    'class AppSecondaryStationheadHandle final',
  );
  const primaryStart = section(
    primaryHandle,
    '  void Start() {',
    '  void Stop() {',
  );
  assert.match(primaryStart, /if \(!CanStartPlayer\(\)\) return;/);
  assert.match(primaryStart, /SetStartupPrimaryHandle\(this\);/);
  assert.match(primaryHandle, /void ExpandStartupPreviewForSecondary\(/);
  assert.match(primaryHandle, /void RestoreRequestedStartupPreviewBounds\(\)/);

  const secondaryHandle = section(
    handleHeader,
    'class AppSecondaryStationheadHandle final',
    '}  // namespace hp',
  );
  const secondaryPreview = section(
    secondaryHandle,
    '  void SetStartupPreviewBounds(const RECT& bounds) {',
    '  void ClearStartupPreviewBounds() {',
  );
  assert.match(secondaryPreview, /pendingStartupPreviewBounds_ = bounds;/);
  assert.doesNotMatch(
    secondaryPreview,
    /StationheadHandleBase::SetStartupPreviewBounds\(bounds\)/,
  );

  const secondaryStart = section(
    secondaryHandle,
    '  void Start() {',
    '  void Tick(int64_t nowMs) {',
  );
  const expandAt = secondaryStart.indexOf(
    'primary->ExpandStartupPreviewForSecondary(pendingStartupPreviewBounds_);',
  );
  const requestAt = secondaryStart.indexOf('startupRequestedAtTick_');
  assert.ok(expandAt >= 0 && requestAt > expandAt);
});

test('Window B exposes its preview only after useful content and then restores Window A left', () => {
  const secondaryHandle = section(
    handleHeader,
    'class AppSecondaryStationheadHandle final',
    '}  // namespace hp',
  );
  const preview = section(
    secondaryHandle,
    '  void ApplyDeferredStartupPreview() {',
    '  RECT pendingStartupPreviewBounds_',
  );
  assert.match(preview, /const StationheadStatus status = RawStatus\(\);/);
  assert.match(preview, /!StationheadStartupPreviewReady\(status\)/);
  const readyAt = preview.indexOf('StationheadStartupPreviewReady(status)');
  const applyAt = preview.indexOf(
    'StationheadHandleBase::SetStartupPreviewBounds(pendingStartupPreviewBounds_);',
  );
  const restoreAt = preview.indexOf('primary->RestoreRequestedStartupPreviewBounds();');
  assert.ok(readyAt >= 0 && applyAt > readyAt && restoreAt > applyAt);
});

test('shutdown cancels pending Window B startup and preview requests', () => {
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
  const resetAt = stop.indexOf('ResetDeferredStartupState(true);');
  const stopAt = stop.indexOf('StationheadHandleBase::Stop();');
  assert.ok(resetAt >= 0 && stopAt > resetAt);

  const reset = section(
    secondaryHandle,
    '  void ResetDeferredStartupState(bool restorePrimary) noexcept {',
    '  void TryStartDeferred() {',
  );
  assert.match(reset, /startupRequestedAtTick_ = 0;/);
  assert.match(reset, /startupPreviewRequested_ = false;/);
  assert.match(reset, /startupPreviewApplied_ = false;/);
});
