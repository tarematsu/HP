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
  assert.match(schedule, /bool MonitorAuthProbeEnabled\(MonitorMode mode\)/);
  assert.match(schedule, /return mode != MonitorMode::Off/);
  assert.match(schedule, /if \(MonitorAuthProbeEnabled\(monitorMode_\)\) RequestMonitorAuthProbe\(\)/);
  assert.match(schedule, /if \(mode == MonitorMode::Off\) monitorAuthForeground_ = false/);
  assert.match(schedule, /SetSpotifyMonitorGridVisible\(mode == MonitorMode::ServiceGrid\)/);
  assert.match(schedule, /if \(MonitorAuthProbeEnabled\(monitorMode_\)\) RequestMonitorAuthProbe\(\)/);
});

test('Stationhead auth is only a temporary Monitor S overlay', () => {
  assert.match(routing, /if \(monitorMode_ == MonitorMode::Off\) break/);
  assert.match(routing, /if \(serviceGrid\) SetSpotifyMonitorGridVisible\(true\)/);
  assert.match(routing, /monitorAuthForeground_ \? parentClient : serviceTile/);
  assert.match(
    routing,
    /monitorMode_ == MonitorMode::ServiceGrid && !detected[\s\S]*SetSpotifyMonitorGridVisible\(false\)[\s\S]*SetSpotifyMonitorGridVisible\(true\)/,
  );
});
