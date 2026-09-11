import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const radarUi = readFileSync(
  new URL('../../native/src/renderer_radar_ui.cpp', import.meta.url),
  'utf8',
);
const radarSection = readFileSync(
  new URL('../../native/src/renderer_panels/radar_section.inc', import.meta.url),
  'utf8',
);

test('native radar accepts only the cloud-composited representative frame', () => {
  assert.match(radarUi, /RepresentativeRadarFramePath/);
  assert.match(radarUi, /json::Boolean\(root, L"precomposed"\)/);
  assert.match(radarUi, /frames\.Size\(\) != 1/);
  assert.match(radarUi, /tiles\.Size\(\) != 1/);
  assert.match(radarUi, /json::Number\(tile, L"destX"\)\) != 0/);
  assert.match(radarUi, /json::Number\(tile, L"destY"\)\) != 0/);
  assert.match(radarUi, /\/v1\/radar\/frame\/representative\/latest\.png/);
  assert.match(radarUi, /DecodeImageFileToBitmap\(\s*\*framePath, kRadarCanvasWidth, kRadarCanvasHeight\)/s);
});

test('native radar has no legacy animation or local weather-layer composition path', () => {
  for (const legacy of [
    'frameIntervalMs',
    'animationIntervalMs',
    'selectedIndex',
    'RadarForecastHasNoRain',
    'RadarTileHasRain',
    'RadarVisibleTileRect',
    'radar-satellite.png',
    'radar-map.png',
    'SaveBitmapAsBmp',
  ]) {
    assert.equal(radarUi.includes(legacy), false, `legacy radar path remains: ${legacy}`);
  }
  assert.doesNotMatch(radarUi, /wait_for\s*\(/);
  assert.match(radarUi, /radarComposeWake_\.wait\(/);
  assert.match(radarUi, /radarTimeText_\.clear\(\)/);
});

test('native radar renders only in the semantic radar section', () => {
  assert.match(radarSection, /StretchRadarInto\(dc, bounds, radarFrameBitmap_\)/);
  assert.match(radarUi, /InvalidatePanelSection\(nativeMainWindow_, PanelSection::Radar\)/);
});
