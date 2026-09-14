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

test('Stationhead background playback is low-memory and controller-invisible', () => {
  assert.match(layout, /SetControllerMemoryUsageTarget/);
  assert.match(layout, /COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW/);
  assert.match(layout, /const BOOL desiredVisibility = playbackForeground \? TRUE : FALSE/);
  assert.match(layout, /controller->put_IsVisible\(desiredVisibility\)/);
});

test('Stationhead foreground playback restores normal memory and visibility', () => {
  assert.match(layout, /playbackForeground \? COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL/);
  assert.match(layout, /playbackForeground \? TRUE : FALSE/);
  assert.match(layout, /StationheadMonitorForeground\(\)/);
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
