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

test('Monitor S keeps auth probing active across the six Stationhead windows', () => {
  assert.match(schedule, /if \(monitorMode_ != MonitorMode::Off\) RequestMonitorAuthProbe\(\)/);
  assert.match(schedule, /if \(monitorMode_ == MonitorMode::Off \|\| powerSaving_\) return/);
  assert.match(schedule, /monitorAuthSlots_ = 0;[\s\S]*monitorAuthForeground_ = false/);
  assert.doesNotMatch(schedule, /SetSpotifyMonitorGridVisible|SetSpotifyMonitorForegroundSlot/);
  assert.doesNotMatch(schedule, /if \(mode != MonitorMode::Native\) monitorAuthForeground_ = false/);
});

test('auth results are aggregated per Stationhead slot and active auth is rechecked quickly', () => {
  assert.match(schedule, /kMonitorAuthActiveProbeIntervalMs = 1'000/);
  assert.match(
    schedule,
    /monitorAuthForeground_[\s\S]*\? kMonitorAuthActiveProbeIntervalMs[\s\S]*: kMonitorAuthProbeIntervalMs/,
  );
  assert.match(routing, /const unsigned slot = static_cast<unsigned>\(lParam\)/);
  assert.match(routing, /const uint32_t bit = 1u << slot/);
  assert.match(routing, /monitorAuthSlots_ \|= bit/);
  assert.match(routing, /monitorAuthSlots_ &= ~bit/);
  assert.match(routing, /const bool detected = monitorAuthSlots_ != 0/);
  assert.match(routing, /monitorAuthForeground_ = detected;[\s\S]*ApplyStationheadMonitorPlacement\(\);[\s\S]*ArmScheduleTimer\(\)/);
});

test('Monitor S keeps all Stationhead playback tiles while auth surface owns its own foreground', () => {
  assert.match(routing, /const bool serviceGrid = monitorMode_ == MonitorMode::ServiceGrid/);
  assert.match(routing, /SetStationheadMonitorForeground\(serviceGrid\)/);
  assert.match(routing, /StationheadServiceTileIndex\(child\)/);
  assert.match(routing, /ServiceMonitorTileBounds\(context->parentClient, tileIndex\)/);
  assert.doesNotMatch(routing, /SetSpotifyMonitorGridVisible/);
});
