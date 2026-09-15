import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const anchors = source('media_surface_anchor.h');
const stationhead = source('stationhead_monitor_probe.h');
const spotify = source('spotify_host_layout.inc');
const windows = source('renderer_panels/windows.inc');
const panelLayout = source('renderer_panels/layout_overrides.inc');

test('Stationhead and Spotify use portrait 160x320 surfaces anchored to clock and air cards', () => {
  assert.match(stationhead, /kStationheadSurfaceWidth = 160/);
  assert.match(stationhead, /kStationheadSurfaceHeight = 320/);
  assert.match(stationhead, /anchors\.clock/);
  assert.match(spotify, /kSpotifyBackgroundWidth = 160/);
  assert.match(spotify, /kSpotifyBackgroundHeight = 320/);
  assert.match(spotify, /anchors\.air/);
  assert.match(anchors, /ComputeMediaSurfaceAnchors/);
  assert.match(anchors, /CenterMediaSurfaceOnAnchor/);
});

test('lower dashboard cards keep their shifted positions while weather and radar exchange widths', () => {
  assert.match(windows, /PanelSection::Energy:\s*rect = sections\.weather/);
  assert.match(windows, /PanelSection::Weather: rect = sections\.radar/);
  assert.match(windows, /PanelSection::Radar: rect = sections\.energy/);
  assert.match(windows, /DrawEnergySection\(scope\.dc, sections\.weather\)/);
  assert.match(windows, /DrawWeatherSection\(scope\.dc, sections\.radar\)/);
  assert.match(windows, /DrawRadarSection\(scope\.dc, sections\.energy\)/);
  assert.match(panelLayout, /leftWidth = std::max\(1, rowWidth \* 35 \/ 100\)/);
  assert.match(panelLayout, /RECT\{client\.left, client\.top, client\.left \+ leftWidth, client\.bottom\}/);
  assert.match(panelLayout, /RECT\{layout\.sections\.radar\.right \+ gapX, client\.top, client\.right, client\.bottom\}/);
});
