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
const radarCache = readFileSync(
  new URL('../../native/src/cloud_client_radar_cache.cpp', import.meta.url),
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

test('cloud radar renders a z8-equivalent 1920x1280 three-panel image', () => {
  assert.match(cloudRadar, /const RADAR_DISPLAY_ZOOM_OFFSET = 2;/);
  assert.match(cloudRadar, /const RADAR_PANEL_SOURCE_WIDTH = 160;/);
  assert.match(cloudRadar, /const RADAR_PANEL_SOURCE_HEIGHT = 320;/);
  assert.match(cloudRadar, /const RADAR_OUTPUT_WIDTH = 1920;/);
  assert.match(cloudRadar, /const RADAR_OUTPUT_HEIGHT = 1280;/);
  assert.match(cloudRadar, /renderRepresentativeRadarFrame/);
  assert.match(cloudRadar, /precomposed: true/);
  assert.match(cloudRadar, /frames: \[frame\]/);
  assert.match(browserRadar, /payload\.outputWidth \/ payload\.panels\.length/);
  assert.match(browserRadar, /const panelAspect = panelWidth \/ payload\.outputHeight/);
  assert.match(browserRadar, /divider < payload\.panels\.length/);
  assert.doesNotMatch(cloudRadar, /envNumber\(env\.RADAR_WIDTH/);
  assert.doesNotMatch(cloudRadar, /envNumber\(env\.RADAR_HEIGHT/);
});

test('cloud selects current, exact one-hour, and latest short-term panels', () => {
  assert.match(cloudRadar, /const RADAR_FORECAST_WINDOW_MS = 60 \* 60 \* 1000;/);
  assert.match(cloudRadar, /selectOneHourForecastEntry/);
  assert.match(cloudRadar, /jmaTimestampToMillis\(entry\.validtime\) === targetAt/);
  assert.match(cloudRadar, /selectLatestShortTermEntry/);
  assert.match(cloudRadar, /entry\.member === undefined \|\| entry\.member === "none"/);
  assert.match(cloudRadar, /panelRequest\(env, "現在", "jma"/);
  assert.match(cloudRadar, /panelRequest\(env, "1時間後", "jma"/);
  assert.match(cloudRadar, /panelRequest\(env, "取得可能な最後", "rasrf"/);
  assert.doesNotMatch(cloudRadar, /RADAR_TERMINAL_WINDOW_MS/);
  assert.doesNotMatch(cloudRadar, /rainSamples|intensityPoints|maxIntensityRank|coverageWeight/);
  assert.match(radarUi, /frames\.Size\(\) != 1/);
  assert.doesNotMatch(radarUi, /frameIntervalMs|animationIntervalMs|selectedIndex/);
  assert.match(radarCache, /const bool precomposed = root\.GetNamedBoolean\(L"precomposed", false\);/);
  assert.match(radarCache, /width != 1920 \|\| height != 1280/);
  assert.match(radarCache, /frames\.Size\(\) != 1/);
  assert.match(radarCache, /tiles\.Size\(\) != 1/);
});

test('native build still carries legacy base layers only as inert packaged assets', () => {
  assert.match(buildRadarBase, /\$satelliteImage\.Width \* 0\.4/);
  assert.match(buildRadarBase, /\$satelliteImage\.Height \* 0\.4/);
  assert.match(buildRadarBase, /\$cropLeft = \[int\]\[Math\]::Floor/);
  assert.match(buildRadarBase, /\$cropTop = \[int\]\[Math\]::Floor/);
  assert.match(buildRadarBase, /Write-CroppedLayer -Image \$satelliteImage/);
  assert.match(buildRadarBase, /Write-CroppedLayer -Image \$mapImage/);

  assert.match(cmake, /generated\/radar-satellite\.png/);
  assert.match(cmake, /generated\/radar-map\.png/);
  assert.match(resource, /110 RCDATA "@HOMEPANEL_RADAR_SATELLITE@"/);
  assert.match(resource, /112 RCDATA "@HOMEPANEL_RADAR_MAP@"/);
  assert.match(embeddedUi, /\{110, L"radar-satellite\.png"\}/);
  assert.match(embeddedUi, /\{112, L"radar-map\.png"\}/);
});

test('native runtime never composes satellite, rain tiles, or white map locally', () => {
  assert.match(radarUi, /RepresentativeRadarFramePath/);
  assert.match(radarUi, /representative\/latest\.png/);
  assert.match(radarUi, /DecodeImageFileToBitmap/);
  assert.doesNotMatch(radarUi, /radar-satellite\.png|radar-map\.png/);
  assert.doesNotMatch(radarUi, /CachedRadarBitmap|RadarTile|BlendBitmap|AlphaBlend/);
  assert.doesNotMatch(radarUi, /for \(const RadarTile& tile/);
});
