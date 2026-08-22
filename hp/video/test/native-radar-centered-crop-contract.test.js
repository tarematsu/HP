import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cloudRadar = readFileSync(
  new URL('../../cloud/src/radar_source.ts', import.meta.url),
  'utf8',
);
const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const resource = readFileSync(
  new URL('../../native/resources/HomePanel.rc.in', import.meta.url),
  'utf8',
);
const embeddedUi = readFileSync(
  new URL('../../native/src/embedded_ui.cpp', import.meta.url),
  'utf8',
);
const radarUi = readFileSync(
  new URL('../../native/src/renderer_radar_ui.cpp', import.meta.url),
  'utf8',
);
const buildRadarBase = readFileSync(
  new URL('../../native/scripts/build-radar-base.ps1', import.meta.url),
  'utf8',
);

test('cloud radar signs and prewarms only the centered forty-percent viewport', () => {
  assert.match(cloudRadar, /const RADAR_SOURCE_WIDTH = 192;/);
  assert.match(cloudRadar, /const RADAR_SOURCE_HEIGHT = 128;/);
  assert.match(cloudRadar, /const width = RADAR_SOURCE_WIDTH;/);
  assert.match(cloudRadar, /const height = RADAR_SOURCE_HEIGHT;/);
  assert.match(cloudRadar, /radarTileLayout\(center\.lat, center\.lon, zoom, width, height\)/);
  assert.match(cloudRadar, /prewarmRadarBundle\(env, payload, entries\[0\]!\.basetime\)/);
  assert.doesNotMatch(cloudRadar, /envNumber\(env\.RADAR_WIDTH/);
  assert.doesNotMatch(cloudRadar, /envNumber\(env\.RADAR_HEIGHT/);
});

test('native build crops satellite and map separately before embedding', () => {
  assert.match(buildRadarBase, /\$satelliteImage\.Width \* 0\.4/);
  assert.match(buildRadarBase, /\$satelliteImage\.Height \* 0\.4/);
  assert.match(buildRadarBase, /\$cropLeft = \[int\]\[Math\]::Floor/);
  assert.match(buildRadarBase, /\$cropTop = \[int\]\[Math\]::Floor/);
  assert.match(buildRadarBase, /Write-CroppedLayer -Image \$satelliteImage/);
  assert.match(buildRadarBase, /Write-CroppedLayer -Image \$mapImage/);
  assert.doesNotMatch(buildRadarBase, /DrawImage\(\$satelliteImage[\s\S]*DrawImage\(\$mapImage/);

  assert.match(cmake, /generated\/radar-satellite\.png/);
  assert.match(cmake, /generated\/radar-map\.png/);
  assert.match(cmake, /-SatelliteOutput "\$\{HOMEPANEL_RADAR_SATELLITE\}"/);
  assert.match(cmake, /-MapOutput "\$\{HOMEPANEL_RADAR_MAP\}"/);
  assert.match(resource, /110 RCDATA "@HOMEPANEL_RADAR_SATELLITE@"/);
  assert.match(resource, /112 RCDATA "@HOMEPANEL_RADAR_MAP@"/);
});

test('runtime keeps satellite, rain tiles, and white map as three ordered layers', () => {
  assert.match(embeddedUi, /\{110, L"radar-satellite\.png"\}/);
  assert.match(embeddedUi, /\{112, L"radar-map\.png"\}/);
  assert.doesNotMatch(embeddedUi.match(/constexpr RuntimeAsset kRuntimeAssets\[\][\s\S]*?\};/)?.[0] ?? '', /radar-base\.png/);

  assert.match(radarUi, /constexpr int kRadarLayerWidth = 768;/);
  assert.match(radarUi, /constexpr int kRadarLayerHeight = 512;/);
  assert.match(radarUi, /uiDir \/ L"radar-satellite\.png"/);
  assert.match(radarUi, /uiDir \/ L"radar-map\.png"/);
  assert.match(radarUi, /CachedRadarBitmap\(\s*L"radar-satellite"/s);
  assert.match(radarUi, /CachedRadarBitmap\(\s*L"radar-map"/s);
  assert.match(radarUi, /BlendBitmap\(composeDc, satelliteBitmap[\s\S]*for \(const RadarTile& tile : tiles\)[\s\S]*BlendBitmap\(composeDc, tileBitmap[\s\S]*BlendBitmap\(composeDc, mapBitmap/s);
  assert.match(radarUi, /CachedRadarBitmap\(L"radar-tile:" \+ tile\.url, tile\.path,[\s\S]*256, 256\)/);
});