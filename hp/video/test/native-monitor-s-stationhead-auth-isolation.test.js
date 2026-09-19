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

test('Monitor S keeps Stationhead auth probing without disabling Spotify grid', () => {
  assert.match(schedule, /if \(monitorMode_ != MonitorMode::Off\) RequestMonitorAuthProbe\(\)/);
  assert.match(schedule, /if \(monitorMode_ == MonitorMode::Off \|\| powerSaving_\) return/);
  assert.match(schedule, /if \(mode == MonitorMode::Off\) monitorAuthForeground_ = false/);
  assert.match(schedule, /SetSpotifyMonitorGridVisible\(mode == MonitorMode::ServiceGrid\)/);
  assert.doesNotMatch(schedule, /if \(mode != MonitorMode::Native\) monitorAuthForeground_ = false/);
});

test('active Stationhead auth is rechecked quickly and Monitor S recovers immediately', () => {
  assert.match(schedule, /kMonitorAuthActiveProbeIntervalMs = 1'000/);
  assert.match(
    schedule,
    /monitorAuthForeground_[\s\S]*\? kMonitorAuthActiveProbeIntervalMs[\s\S]*: kMonitorAuthProbeIntervalMs/,
  );
  assert.match(routing, /monitorAuthForeground_ = detected;[\s\S]*ApplyStationheadMonitorPlacement\(\);[\s\S]*ArmScheduleTimer\(\)/);
  assert.match(routing, /if \(serviceGrid\) SetSpotifyMonitorGridVisible\(true\)/);
  assert.match(routing, /monitorAuthForeground_ \? parentClient : serviceTile/);
  assert.match(
    routing,
    /monitorMode_ == MonitorMode::ServiceGrid && !detected[\s\S]*SetSpotifyMonitorGridVisible\(false\)[\s\S]*SetSpotifyMonitorGridVisible\(true\)/,
  );
});
