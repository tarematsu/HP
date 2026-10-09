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

test('cloud radar renders a z10 640x360 three-panel image from the original logical map extent', () => {
  assert.match(cloudRadar, /const RADAR_BASE_ZOOM = 10;/);
  assert.match(cloudRadar, /const RADAR_DISPLAY_ZOOM = 10;/);
  assert.match(cloudRadar, /const RADAR_PANEL_SOURCE_WIDTH = 432;/);
  assert.match(cloudRadar, /const RADAR_PANEL_SOURCE_HEIGHT = 729;/);
  assert.match(cloudRadar, /const RADAR_BASE_CROP_WIDTH = 432;/);
  assert.match(cloudRadar, /const RADAR_BASE_CROP_HEIGHT = 729;/);
  assert.match(cloudRadar, /const RADAR_OUTPUT_WIDTH = 640;/);
  assert.match(cloudRadar, /const RADAR_OUTPUT_HEIGHT = 360;/);
  assert.match(cloudRadar, /downsampled/);
  assert.match(cloudRadar, /renderRepresentativeRadarFrame/);
  assert.match(cloudRadar, /precomposed: true/);
  assert.match(cloudRadar, /frames: \[frame\]/);
  assert.match(browserRadar, /const logicalPanelWidth = payload\.panels\[0\]\?\.sourceWidth \?\? 0;/);
  assert.match(browserRadar, /const logicalOutputHeight = payload\.panels\[0\]\?\.sourceHeight \?\? 0;/);
  assert.match(browserRadar, /const logicalOutputWidth = logicalPanelWidth \* payload\.panels\.length;/);
  assert.match(browserRadar, /context\.scale\(/);
  assert.match(browserRadar, /payload\.outputWidth \/ logicalOutputWidth/);
  assert.match(browserRadar, /payload\.outputHeight \/ logicalOutputHeight/);
  assert.match(browserRadar, /panel\.sourceWidth !== logicalPanelWidth/);
  assert.match(browserRadar, /panel\.sourceHeight !== logicalOutputHeight/);
  assert.match(browserRadar, /panel\.baseCropWidth !== logicalPanelWidth/);
  assert.match(browserRadar, /panel\.baseCropHeight !== logicalOutputHeight/);
  assert.match(browserRadar, /must match logical render pixels/);
  assert.match(browserRadar, /const cropWidth = panel\.baseCropWidth as number/);
  assert.match(browserRadar, /const cropHeight = panel\.baseCropHeight as number/);
  assert.match(browserRadar, /drawLocationMarker\(panel, panelX\)/);
  assert.match(browserRadar, /location: request\.location/);
  assert.doesNotMatch(browserRadar, /kawagoe-mask|KAWAGOE|city\/geojson/);
  assert.doesNotMatch(browserRadar, /MAP_ASSET_PATH|drawBase\(map/);
  assert.match(browserRadar, /divider < payload\.panels\.length/);
  assert.doesNotMatch(browserRadar, /const panelAspect = panelWidth \/ payload\.outputHeight/);
  assert.doesNotMatch(cloudRadar, /envNumber\(env\.RADAR_WIDTH/);
  assert.doesNotMatch(cloudRadar, /envNumber\(env\.RADAR_HEIGHT/);
  assert.doesNotMatch(cloudRadar, /env\.RADAR_ZOOM|env\.RADAR_CENTER_LAT|env\.RADAR_CENTER_LON/);
});

test('cloud selects latest observation and exact next 22:00/09:00 JST with latest fallback', () => {
  assert.match(cloudRadar, /selectLatestObservedRadarEntry/);
  assert.match(cloudRadar, /JMA_NOWCAST_FORECAST_TIMES_URL/);
  assert.match(cloudRadar, /selectNextRadarForecast\(shortTerm, nowcast, 22, referenceAt\)/);
  assert.match(cloudRadar, /selectNextRadarForecast\(shortTerm, nowcast, 9, referenceAt\)/);
  assert.match(cloudRadar, /selectNextNowcastEntry\(nowcast, hour, referenceAt\)/);
  assert.match(cloudRadar, /const JST_OFFSET_MS = 9 \* 60 \* 60 \* 1000;/);
  assert.match(cloudRadar, /if \(targetAt <= referenceAt\) targetAt \+= DAY_MS;/);
  assert.match(cloudRadar, /const exact = available\.filter\(entry => jmaTimestampToMillis\(entry\.validtime\) === targetAt\)/);
  assert.match(cloudRadar, /return \(exact\.length \? exact : available\)/);
  assert.match(cloudRadar, /entry\.member === undefined \|\| entry\.member === "none"/);
  assert.match(cloudRadar, /\{ validTimeText: jstTimeText\(currentEntry\) \}/);
  assert.match(cloudRadar, /\{ validTimeText: jstTimeText\(twentyTwoEntry\) \}/);
  assert.match(cloudRadar, /\{ validTimeText: jstTimeText\(nineEntry\) \}/);
  assert.match(cloudRadar, /panelRequest\(env, "jma", currentEntry/);
  assert.match(cloudRadar, /panelRequest\(env, twentyTwoForecast\.product, twentyTwoEntry/);
  assert.match(cloudRadar, /panelRequest\(env, nineForecast\.product, nineEntry/);
  assert.doesNotMatch(cloudRadar, /JMA_FORECAST_TIMES_URL|selectOneHourForecastEntry|RADAR_FORECAST_WINDOW_MS/);
  assert.doesNotMatch(cloudRadar, /title:/);
  assert.doesNotMatch(cloudRadar, /現在|1時間後|取得可能な最後/);
  assert.doesNotMatch(cloudRadar, /RADAR_TERMINAL_WINDOW_MS/);
  assert.doesNotMatch(cloudRadar, /rainSamples|intensityPoints|maxIntensityRank|coverageWeight/);
  assert.match(radarUi, /frames\.Size\(\) != 1/);
  assert.doesNotMatch(radarUi, /frameIntervalMs|animationIntervalMs|selectedIndex/);
  assert.match(radarCache, /const bool precomposed = root\.GetNamedBoolean\(L"precomposed", false\);/);
  assert.match(radarCache, /width != 640 \|\| height != 360/);
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