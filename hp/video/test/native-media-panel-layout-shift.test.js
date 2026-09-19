import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const stationhead = source('stationhead_monitor_probe.h');
const routing = source('power_saving_window_routing.inc');
const grid = source('service_monitor_grid.h');
const spotify = source('spotify_host_layout.inc');
const windows = source('renderer_panels/windows.inc');
const renderer = source('renderer_panels.cpp');

test('Monitor S parks Stationhead and five Spotify hosts across the full screen', () => {
  assert.match(stationhead, /StationheadBackgroundBounds\(const RECT& workspaceBounds\)[\s\S]*return workspaceBounds;/);
  assert.match(grid, /kServiceMonitorTileCount = 6/);
  assert.match(grid, /kServiceMonitorColumns = 3/);
  assert.match(grid, /kServiceMonitorRows = 2/);
  assert.doesNotMatch(grid, /ComputeNativeDashboardLayout/);
  assert.match(grid, /workspaceBounds\.right - workspaceBounds\.left/);
  assert.match(grid, /workspaceBounds\.bottom - workspaceBounds\.top/);
  assert.match(routing, /ServiceMonitorTileBounds\(parentClient, 0\)/);
  assert.match(routing, /monitorMode_ == MonitorMode::Native && monitorAuthForeground_/);
  assert.match(spotify, /ServiceMonitorTileBounds\(client, i \+ 1\)/);
  assert.match(spotify, /const RECT desired = loginPage \? fullClient : serviceTile/);
  assert.match(spotify, /gSpotifyMonitorGridVisible && !loginPage/);
});

test('lower dashboard cards shift energy to old weather, weather to old radar, and radar to old energy slots', () => {
  assert.match(windows, /PanelSection::Energy:\s*rect = sections\.weather/);
  assert.match(windows, /PanelSection::Weather: rect = sections\.radar/);
  assert.match(windows, /PanelSection::Radar: rect = sections\.energy/);
  assert.match(windows, /DrawEnergySection\(scope\.dc, sections\.weather\)/);
  assert.match(windows, /DrawWeatherSection\(scope\.dc, sections\.radar\)/);
  assert.match(windows, /DrawRadarSection\(scope\.dc, sections\.energy\)/);
});

test('weather matches the left-column card size and radar uses the remainder', () => {
  assert.match(renderer, /MainSections SplitWeatherRadarMatchedMainSections/);
  assert.match(renderer, /dashboard\.side\.right - dashboard\.side\.left/);
  assert.match(renderer, /const LONG rowHeight = std::max<LONG>\(1, \(sideHeight - sideGap \* 2\) \/ 3\)/);
  assert.match(renderer, /const LONG weatherWidth = std::clamp<LONG>\(\s*sideWidth/);
  assert.match(renderer, /const LONG bottom = std::min<LONG>\(client\.bottom, client\.top \+ rowHeight\)/);
  assert.match(renderer, /sections\.radar = RECT\{\s*client\.left, client\.top, client\.left \+ weatherWidth, bottom\}/);
  assert.match(renderer, /sections\.energy = RECT\{\s*sections\.radar\.right \+ gapX, client\.top, client\.right, bottom\}/);
  assert.match(renderer, /#define SplitMainSections\(client\)[\s\\]*SplitWeatherRadarMatchedMainSections\(\(client\), bounds_\)/);
});