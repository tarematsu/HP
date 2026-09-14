import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(
  new URL('../../native/src/sh_layout.cpp', import.meta.url),
  'utf8',
);
const routing = readFileSync(
  new URL('../../native/src/power_saving_window_routing.inc', import.meta.url),
  'utf8',
);
const bridge = readFileSync(
  new URL('../../native/src/stationhead_monitor_probe.h', import.meta.url),
  'utf8',
);
const appMessages = readFileSync(
  new URL('../../native/src/app_messages.cpp', import.meta.url),
  'utf8',
);

test('Stationhead background playback may suppress 1x1 rendering without forcing a LOW memory target', () => {
  assert.doesNotMatch(layout, /SetControllerMemoryUsageTarget/);
  assert.doesNotMatch(layout, /put_MemoryUsageTargetLevel/);
  assert.doesNotMatch(layout, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/);
  assert.match(layout, /StationheadPlaybackRenderingSuppressed\(controller\)/);
  assert.match(
    layout,
    /const BOOL playbackControllerVisible\s*=\s*playbackFullSize \|\|\s*!StationheadPlaybackRenderingSuppressed\(controller\)[\s\S]*\? TRUE\s*:\s*FALSE;/,
  );
  assert.match(layout, /controller->put_IsVisible\(playbackControllerVisible\)/);
});

test('Stationhead playback and auth leave WebView2 memory targets unmanaged in foreground', () => {
  assert.doesNotMatch(layout, /SetControllerMemoryUsageTarget/);
  assert.doesNotMatch(layout, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/);
  assert.match(layout, /StationheadMonitorForeground\(\)/);
  assert.match(layout, /authController->put_IsVisible\(TRUE\)/);
});

test('Monitor B and Monitor A auth promotion drive the effective foreground bit', () => {
  assert.match(
    routing,
    /monitorMode_ == MonitorMode::Stationhead \|\|[\s\S]*monitorMode_ == MonitorMode::Native && monitorAuthForeground_/,
  );
  assert.match(routing, /SetStationheadMonitorForeground\(stationheadForeground\)/);
  assert.match(routing, /PostMessageW\(parent_, WM_TIMER, 0, 0\)/);
  assert.match(bridge, /inline std::atomic<bool> gStationheadMonitorForeground\{false\}/);
});

test('Stationhead monitor wake invalidates cached placement before Tick relayout', () => {
  assert.match(
    appMessages,
    /case WM_TIMER:[\s\S]*if \(wParam == 0\) MarkStationheadPlacementDirty\(\);[\s\S]*Tick\(\);/,
  );
});