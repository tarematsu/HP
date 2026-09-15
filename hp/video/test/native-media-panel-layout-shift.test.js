import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const stationhead = source('stationhead_monitor_probe.h');
const spotify = source('spotify_host_layout.inc');
const windows = source('renderer_panels/windows.inc');

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
