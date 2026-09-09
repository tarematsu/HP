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
const cloudClient = readFileSync(
  new URL('../../native/src/cloud_client_sync.cpp', import.meta.url),
  'utf8',
);
const browserRadar = readFileSync(
  new URL('../../cloud/src/radar_browser_frame.ts', import.meta.url),
  'utf8',
);
const buildRadarBase = readFileSync(
  new URL('../../native/scripts/build-radar-base.ps1', import.meta.url),
  'utf8',
);

test('cloud radar renders a z9-equivalent 1920x1280 dual-panel image', () => {
  assert.match(cloudRadar, /const RADAR_DISPLAY_ZOOM_OFFSET = 1;/);
  assert.match(cloudRadar, /const RADAR_PANEL_SOURCE_WIDTH = 384;/);
  assert.match(cloudRadar, /const RADAR_PANEL_SOURCE_HEIGHT = 512;/);
  assert.match(cloudRadar, /const RADAR_OUTPUT_WIDTH = 1920;/);
  assert.match(cloudRadar, /const RADAR_OUTPUT_HEIGHT = 1280;/);
  assert.match(cloudRadar, /renderRepresentativeRadarFrame/);
  assert.match(cloudRadar, /precomposed: true/);
  assert.match(cloudRadar, /frames: \[frame\]/);
  assert.match(browserRadar, /bitmap\.width \* 0\.4/);
  assert.match(browserRadar, /bitmap\.height \* 0\.8/);
  assert.doesNotMatch(cloudRadar, /envNumber\(env\.RADAR_WIDTH/);
  assert.doesNotMatch(cloudRadar, /envNumber\(env\.RADAR_HEIGHT/);
});

test('cloud selects current-through-one-hour and terminal-forecast-minus-two-hour panels', () => {
  assert.match(cloudRadar, /const RADAR_FORECAST_WINDOW_MS = 60 \* 60 \* 1000;/);
  assert.match(cloudRadar, /const RADAR_TERMINAL_WINDOW_MS = 2 \* 60 \* 60 \* 1000;/);
  assert.match(cloudRadar, /validAt > currentAt && validAt <= forecastEnd/);
  assert.match(cloudRadar, /validAt >= startAt[\s\S]*validAt <= terminalAt/);
  assert.match(cloudRadar, /"現在〜1時間"/);
  assert.match(cloudRadar, /"予報終端±2時間"/);
  assert.match(radarUi, /animationIntervalMs = frames\.Size\(\) > 1 \? frameIntervalMs : 0;/);
  assert.match(cloudClient, /const bool precomposed = root\.GetNamedBoolean\(L"precomposed", false\);/);
  assert.match(cloudClient, /if \(precomposed \|\| !fs::exists\(target, error\)/);
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
