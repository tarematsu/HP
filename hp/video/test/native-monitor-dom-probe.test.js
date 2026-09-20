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

test('visible monitor modes probe targeted Stationhead controls every five minutes', () => {
  assert.match(schedule, /kMonitorAuthProbeIntervalMs = 5 \* 60'000/);
  assert.match(schedule, /monitorMode_ != MonitorMode::Off[\s\S]*RequestMonitorAuthProbe\(\)/);
  assert.match(schedule, /monitorMode_ != MonitorMode::Off[\s\S]*kMonitorAuthProbeIntervalMs/);
  assert.match(audioLoss, /kMonitorDomProbeScript/);
  assert.match(audioLoss, /document\.querySelectorAll\(selector\)/);
  assert.match(audioLoss, /\\blog\\s\+in\\b/);
  assert.match(audioLoss, /\\bconnect\\s\+spotify\\b/);
  assert.match(audioLoss, /surface !== document\.body && depth < 4/);
  const monitorProbe = audioLoss.slice(
    audioLoss.indexOf('constexpr wchar_t kMonitorDomProbeScript[]'),
    audioLoss.indexOf('// This probe is based on the live Stationhead DOM'),
  );
  assert.doesNotMatch(monitorProbe, /document\.body\.(?:innerText|textContent)/);
  assert.doesNotMatch(monitorProbe, /getBoundingClientRect|getComputedStyle/);
  assert.match(audioLoss, /RequestStationheadMonitorDomProbe\(\) noexcept/);
  assert.match(bridge, /kStationheadMonitorProbeResultMessage/);
});

test('monitor S stays foreground while all six Stationhead windows participate in auth polling', () => {
  assert.match(routing, /const bool serviceGrid = monitorMode_ == MonitorMode::ServiceGrid/);
  assert.match(routing, /SetStationheadMonitorForeground\(serviceGrid\)/);
  assert.match(routing, /monitorAuthSlots_/);
  assert.match(schedule, /if \(monitorMode_ != MonitorMode::Off\) \{[\s\S]*kMonitorAuthProbeIntervalMs/);
  assert.match(schedule, /if \(monitorMode_ == MonitorMode::Off \|\| powerSaving_\) return/);
});

test('monitor YT aggregates clean auth probes and returns Stationhead behind the dashboard', () => {
  assert.match(
    routing,
    /case kStationheadMonitorProbeResultMessage:[\s\S]*const unsigned slot = static_cast<unsigned>\(lParam\);[\s\S]*const uint32_t bit = 1u << slot;[\s\S]*const bool detected = monitorAuthSlots_ != 0;[\s\S]*monitorAuthForeground_ = detected;[\s\S]*ApplyStationheadMonitorPlacement\(\)/,
  );
  assert.match(routing, /const bool nativeMediaForeground =\s*monitorMode_ == MonitorMode::Native && !monitorAuthForeground_/);
});
