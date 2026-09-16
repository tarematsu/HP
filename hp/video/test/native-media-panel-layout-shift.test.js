import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const stationhead = source('stationhead_monitor_probe.h');
const spotify = source('spotify_host_layout.inc');
const windows = source('renderer_panels/windows.inc');
const renderer = source('renderer_panels.cpp');

test('Stationhead and Spotify fill the dashboard client area without fixed window sizes', () => {
  assert.match(stationhead, /StationheadBackgroundBounds\(const RECT& workspaceBounds\)[\s\S]*return workspaceBounds;/);
  assert.doesNotMatch(stationhead, /kStationheadSurfaceWidth|kStationheadSurfaceHeight|CenterMediaSurfaceOnAnchor/);
  assert.match(spotify, /const int hostX = client\.left;/);
  assert.match(spotify, /const int hostY = client\.top;/);
  assert.match(spotify, /const int width = std::max\(1L, client\.right - client\.left\);/);
  assert.match(spotify, /const int height = std::max\(1L, client\.bottom - client\.top\);/);
  assert.doesNotMatch(spotify, /kSpotifyBackgroundWidth|kSpotifyBackgroundHeight|CenterMediaSurfaceOnAnchor|anchors\.air/);
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
