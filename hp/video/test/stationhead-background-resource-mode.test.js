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

test('Stationhead background playback keeps a full internal surface without forcing a memory target', () => {
  assert.doesNotMatch(
    layout,
    /SetControllerMemoryUsageTarget|put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/,
  );
  assert.match(bridge, /StationheadBackgroundBounds\(const RECT& workspaceBounds\)[\s\S]*return workspaceBounds;/);
  assert.doesNotMatch(bridge, /kStationheadSurfaceWidth|kStationheadSurfaceHeight|ComputeMediaSurfaceAnchors|anchors\.clock|CenterMediaSurfaceOnAnchor/);
  assert.match(layout, /playbackHostBounds = surfaceBounds/);
  assert.doesNotMatch(layout, /StationheadOffscreenBounds/);
  assert.match(layout, /controller->put_IsVisible\(TRUE\)/);
  assert.doesNotMatch(layout, /put_IsVisible\(FALSE\)/);
});

test('Stationhead playback and auth leave the WebView2 memory target unmanaged in foreground', () => {
  assert.doesNotMatch(
    layout,
    /SetControllerMemoryUsageTarget|put_MemoryUsageTargetLevel|COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_(?:LOW|NORMAL)/,
  );
  assert.match(layout, /StationheadMonitorForeground\(\)/);
  assert.match(layout, /authController->put_IsVisible\(TRUE\)/);
});

test('Monitor E and Monitor A auth promotion drive the effective foreground bit', () => {
  assert.match(
    routing,
    /monitorMode_ == MonitorMode::SpotifyTertiary \|\|[\s\S]*monitorMode_ == MonitorMode::Native && monitorAuthForeground_/,
  );
  assert.match(routing, /SetStationheadMonitorForeground\(stationheadForeground\)/);
  assert.match(routing, /PostMessageW\(parent_, WM_TIMER, 0, 0\)/);
  assert.match(bridge, /inline std::atomic<bool> gStationheadMonitorForeground\{false\}/);
  assert.match(layout, /ApplyHostVisualClip\(hostWindow, playbackForeground\)/);
});

test('Stationhead monitor wake invalidates cached placement before Tick relayout', () => {
  assert.match(
    appMessages,
    /case WM_TIMER:[\s\S]*if \(wParam == 0\) MarkStationheadPlacementDirty\(\);[\s\S]*Tick\(\);/,
  );
});
