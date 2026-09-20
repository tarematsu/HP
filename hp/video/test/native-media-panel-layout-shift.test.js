import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const stationhead = source('stationhead_monitor_probe.h');
const routing = source('power_saving_window_routing.inc');
const grid = source('service_monitor_grid.h');
const windows = source('renderer_panels/windows.inc');
const renderer = source('renderer_panels.cpp');

test('named Stationhead monitor promotes only its selected host over the YouTube media panel', () => {
  assert.match(stationhead, /gStationheadMonitorProfile\{0\}/);
  assert.match(stationhead, /StationheadMonitorForegroundForProfile/);
  assert.match(routing, /StationheadProfileNumberFromWindow\(HWND window\)/);
  assert.match(routing, /StationheadProfileNumberFromWindow\(child\) != context->selectedProfile/);
  assert.match(routing, /const RECT monitorBounds = ComputeNativeDashboardLayout\(parentClient\)\.media;/);
  assert.match(routing, /const RECT target = context->monitorBounds;/);
  assert.match(routing, /const bool nativeMediaForeground = monitorMode_ != MonitorMode::Off;/);
  assert.doesNotMatch(routing, /SetSpotifyMonitorGridVisible|SetSpotifyMonitorForegroundSlot/);
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