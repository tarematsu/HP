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

test('Stationhead background playback stays low-memory and may suppress rendering', () => {
  assert.match(layout, /SetControllerMemoryUsageTarget/);
  assert.match(layout, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.match(layout, /StationheadPlaybackRenderingSuppressed\(controller\)/);
  assert.match(
    layout,
    /const BOOL playbackControllerVisible\s*=\s*playbackForeground \|\|\s*!StationheadPlaybackRenderingSuppressed\(controller\)[\s\S]*\? TRUE\s*:\s*FALSE;/,
  );
  assert.match(layout, /controller->put_IsVisible\(playbackControllerVisible\)/);
});

test('Stationhead playback and auth stay low-memory even when foreground', () => {
  assert.match(
    layout,
    /SetControllerMemoryUsageTarget\(\s*controller,\s*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW\s*\)/,
  );
  assert.match(
    layout,
    /SetControllerMemoryUsageTarget\(\s*authController,\s*COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW\s*\)/,
  );
  assert.doesNotMatch(layout, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/);
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
