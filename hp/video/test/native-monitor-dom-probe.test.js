import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schedule = readFileSync(
  new URL('../../native/src/power_saving_schedule.inc', import.meta.url),
  'utf8',
);
const routing = readFileSync(
  new URL('../../native/src/power_saving_window_routing.inc', import.meta.url),
  'utf8',
);
const audioLoss = readFileSync(
  new URL('../../native/src/sh_audio_loss.cpp', import.meta.url),
  'utf8',
);
const bridge = readFileSync(
  new URL('../../native/src/stationhead_monitor_probe.h', import.meta.url),
  'utf8',
);

test('monitor A probes Stationhead DOM every five minutes for requested auth words', () => {
  assert.match(schedule, /kMonitorAuthProbeIntervalMs = 5 \* 60'000/);
  assert.match(schedule, /monitorMode_ == MonitorMode::Native[\s\S]*RequestMonitorAuthProbe\(\)/);
  assert.match(schedule, /monitorMode_ == MonitorMode::Native[\s\S]*kMonitorAuthProbeIntervalMs/);
  assert.match(audioLoss, /kMonitorDomProbeScript/);
  assert.match(audioLoss, /\\blog\\s\+in\\b/);
  assert.match(audioLoss, /\\bconnect\\s\+spotify\\b/);
  assert.match(audioLoss, /RequestStationheadMonitorDomProbe\(\) noexcept/);
  assert.match(bridge, /kStationheadMonitorProbeResultMessage/);
});

test('monitor B is unconditional foreground and does not own DOM polling', () => {
  assert.match(
    routing,
    /monitorMode_ == MonitorMode::Stationhead \|\|[\s\S]*monitorMode_ == MonitorMode::Native &&[\s\S]*monitorAuthForeground_/,
  );
  assert.match(schedule, /if \(monitorMode_ == MonitorMode::Native\) \{[\s\S]*kMonitorAuthProbeIntervalMs/);
  assert.doesNotMatch(schedule, /MonitorMode::Stationhead[\s\S]{0,120}RequestMonitorAuthProbe/);
});

test('monitor A returns Stationhead behind the dashboard after a clean probe', () => {
  assert.match(
    routing,
    /case kStationheadMonitorProbeResultMessage:[\s\S]*const bool detected = wParam != 0;[\s\S]*monitorAuthForeground_ = detected;[\s\S]*ApplyStationheadMonitorPlacement\(\)/,
  );
  assert.match(routing, /child, HWND_BOTTOM/);
});
