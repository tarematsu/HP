import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const anchors = source('media_surface_anchor.h');
const stationhead = source('stationhead_monitor_probe.h');
const spotify = source('spotify_host_layout.inc');
const windows = source('renderer_panels/windows.inc');
const renderer = source('renderer_panels.cpp');

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

test('lower dashboard cards shift energy to old weather, weather to old radar, and radar to old energy slots', () => {
  assert.match(windows, /PanelSection::Energy:\s*rect = sections\.weather/);
  assert.match(windows, /PanelSection::Weather: rect = sections\.radar/);
  assert.match(windows, /PanelSection::Radar: rect = sections\.energy/);
  assert.match(windows, /DrawEnergySection\(scope\.dc, sections\.weather\)/);
  assert.match(windows, /DrawWeatherSection\(scope\.dc, sections\.radar\)/);
  assert.match(windows, /DrawRadarSection\(scope\.dc, sections\.energy\)/);
});

test('weather and radar keep their anchors while exchanging horizontal sizes', () => {
  assert.match(renderer, /MainSections SplitWeatherRadarWidthSwappedMainSections/);
  assert.match(renderer, /weatherWidth =\s*std::max<LONG>\(1, sections\.energy\.right - sections\.energy\.left\)/);
  assert.match(renderer, /radarWidth =\s*std::max<LONG>\(1, sections\.radar\.right - sections\.radar\.left\)/);
  assert.match(renderer, /sections\.radar\.right = std::min<LONG>\(right, left \+ weatherWidth\)/);
  assert.match(renderer, /sections\.energy\.left = std::max<LONG>\(left, right - radarWidth\)/);
  assert.match(renderer, /#define SplitMainSections SplitWeatherRadarWidthSwappedMainSections/);
});
