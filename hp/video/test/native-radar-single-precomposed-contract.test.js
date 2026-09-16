import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const renderer = readFileSync(
  new URL('../../native/src/renderer_radar_ui.cpp', import.meta.url),
  'utf8',
);
const rendererHeader = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../native/src/radar_cache_migration.cpp', import.meta.url),
  'utf8',
);
const cloudClientSync = readFileSync(
  new URL('../../native/src/cloud_client_sync.cpp', import.meta.url),
  'utf8',
);
const radarCache = readFileSync(
  new URL('../../native/src/cloud_client_radar_cache.cpp', import.meta.url),
  'utf8',
);
const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const cloud = readFileSync(
  new URL('../../cloud/src/radar_source.ts', import.meta.url),
  'utf8',
);
const browserFrame = readFileSync(
  new URL('../../cloud/src/radar_browser_frame.ts', import.meta.url),
  'utf8',
);
const wrangler = readFileSync(
  new URL('../../cloud/wrangler.jsonc', import.meta.url),
  'utf8',
);

test('native radar only decodes one 1296x729 representative PNG', () => {
  assert.match(rendererHeader, /kRadarCanvasWidth = 1296/);
  assert.match(rendererHeader, /kRadarCanvasHeight = 729/);
  assert.match(renderer, /kRepresentativeRadarPath/);
  assert.match(renderer, /representative\/latest\.png/);
  assert.match(renderer, /json::Boolean\(root, L"precomposed"\)/);
  assert.match(renderer, /frames\.Size\(\) != 1/);
  assert.match(renderer, /tiles\.Size\(\) != 1/);
  assert.match(renderer, /width != kRadarCanvasWidth \|\| height != kRadarCanvasHeight/);
  assert.match(renderer, /DecodeImageFileToBitmap/);
  assert.doesNotMatch(renderer, /frameIntervalMs|animationIntervalMs|selectedIndex|wait_for\s*\(/);
  assert.doesNotMatch(renderer, /RadarTileHasRain|RadarForecastHasNoRain|BlendBitmap|SaveBitmapAsBmp/);
});

test('legacy local radar cache is removed before CloudClient version negotiation', () => {
  assert.match(cmake, /src\/radar_cache_migration\.cpp/);
  assert.match(migration, /IsSinglePrecomposedRadarJson/);
  assert.match(migration, /text\.find\("\\"precomposed\\":true"\)/);
  assert.match(migration, /representative\/latest\.png/);
  assert.match(migration, /one cloud-composited representative frame/);
  assert.doesNotMatch(migration, /dualPanelProvider|dual-panel frame/);
  assert.match(migration, /fs::remove\(radarJson/);
  assert.match(migration, /radar-frame\.bmp/);
  assert.match(migration, /radar-frame\.signature/);
});

test('radar cache localization is isolated from device version negotiation', () => {
  assert.match(cloudClientSync, /#include "cloud_client_radar_cache\.cpp"/);
  assert.doesNotMatch(cloudClientSync, /std::vector<uint8_t> CloudClient::LocalizeRadarTiles/);
  assert.match(radarCache, /std::vector<uint8_t> CloudClient::LocalizeRadarTiles/);
  assert.match(radarCache, /HasPngSignature\(response\.body\)/);
  assert.match(radarCache, /width != 1296 \|\| height != 729/);
  assert.match(radarCache, /frames\.Size\(\) != 1/);
  assert.match(radarCache, /tiles\.Size\(\) != 1/);
  assert.match(radarCache, /precomposed radar frame unavailable/);
  assert.match(radarCache, /JsonValue::CreateStringValue\(localUrlFor\(url\)\)/);
});

test('precomposed radar version is accepted only after a local PNG exists', () => {
  assert.match(cloudClientSync, /requestedRadarVersion/);
  assert.match(cloudClientSync, /HasPngSignature\(representativeRadarPath\)/);
  assert.match(cloudClientSync, /radarVersion=" \+ std::to_wstring\(requestedRadarVersion\(\)\)/);
  assert.match(cloudClientSync, /Radar payload withheld until representative PNG is available/);
});

test('cloud radar composition has an explicit public origin for Browser Rendering', () => {
  assert.match(cloud, /publicWorkerUrl\(env\)/);
  assert.match(
    wrangler,
    /"HOMEPANEL_PUBLIC_URL": "https:\/\/homepanel-cloud\.tarematsu\.workers\.dev"/,
  );
  assert.match(wrangler, /"browser": \{\s*"binding": "BROWSER"/);
});

test('cloud radar contract remains one z10 native-scale precomposed three-panel representative frame', () => {
  assert.match(cloud, /const RADAR_OUTPUT_WIDTH = 1296/);
  assert.match(cloud, /const RADAR_OUTPUT_HEIGHT = 729/);
  assert.match(cloud, /const RADAR_BASE_ZOOM = 10/);
  assert.match(cloud, /const RADAR_DISPLAY_ZOOM = 10/);
  assert.match(cloud, /const RADAR_PANEL_SOURCE_WIDTH = 432/);
  assert.match(cloud, /const RADAR_PANEL_SOURCE_HEIGHT = 729/);
  assert.match(cloud, /const RADAR_BASE_CROP_WIDTH = 432/);
  assert.match(cloud, /const RADAR_BASE_CROP_HEIGHT = 729/);
  assert.match(cloud, /native-scale/);
  assert.match(cloud, /RADAR_FRAME_PATH = "\/v1\/radar\/frame\/representative\/latest\.png"/);
  assert.match(cloud, /JMA_SHORT_TERM_TIMES_URL/);
  assert.match(cloud, /panelRequest\(env, "jma", currentEntry/);
  assert.match(cloud, /panelRequest\(env, "jma", oneHourEntry/);
  assert.match(cloud, /panelRequest\(env, "rasrf", latestEntry/);
  assert.match(cloud, /precomposed: true/);
  assert.match(cloud, /frames: \[frame\]/);
  assert.match(cloud, /one cloud-composited representative frame/);
  assert.match(browserFrame, /payload\.outputWidth \/ payload\.panels\.length/);
  assert.match(browserFrame, /must match output pixels at 1:1 scale/);
  assert.match(browserFrame, /panelIndex < payload\.panels\.length/);
  assert.match(browserFrame, /divider < payload\.panels\.length/);
});

test('unchanged cloud radar times reuse the existing representative frame', () => {
  assert.match(cloud, /RADAR_COMPOSITION_VERSION/);
  assert.match(cloud, /radarCompositionKey\(currentEntry, oneHourEntry, latestEntry\)/);
  assert.match(cloud, /UPDATE_BUCKET\.head\(representativeFrameKey\(\)\)/);
  assert.match(cloud, /customMetadata\?\.radarCompositionKey !== compositionKey/);
  assert.match(cloud, /customMetadata: \{ radarCompositionKey: compositionKey \}/);
});

test('cloud radar draws a centered current-location marker without a city-boundary asset', () => {
  assert.match(cloud, /const RADAR_CENTER = \{ lat: 35\.8923181, lon: 139\.4858691 \}/);
  assert.match(cloud, /location: RADAR_CENTER/);
  assert.match(browserFrame, /interface BrowserRadarLocation/);
  assert.match(browserFrame, /const world = worldPixel\(lon, lat, panel\.zoom\)/);
  assert.match(browserFrame, /context\.arc\(x, y, 24, 0, fullCircle\)/);
  assert.match(browserFrame, /#4285F4/);
  assert.doesNotMatch(browserFrame, /city\/geojson|kawagoe-mask|fetchKawagoeBoundary|boundaryPolygons/);
  assert.doesNotMatch(cloud, /KAWAGOE_MASK_KEY/);
});

test('cloud radar always composes fetched tiles without rain-presence classification', () => {
  assert.doesNotMatch(browserFrame, /RAIN_ANALYSIS_WIDTH|RAIN_ANALYSIS_HEIGHT/);
  assert.doesNotMatch(browserFrame, /rainCanvas|rainContext|getImageData|hasRain|rainPixels/);
  assert.doesNotMatch(browserFrame, /SUNNY_ICON_ASSET_PATH|drawNoRainPanel|sunnyIcon/);
  assert.match(browserFrame, /for \(const tile of panel\.tiles/);
  assert.match(browserFrame, /if \(!bitmap\) continue;/);
  assert.match(
    browserFrame,
    /context\.drawImage\(\s*bitmap,\s*panelX \+ Math\.round\(tile\.destX \* scaleX\),/s,
  );
});

test('native skips radar JSON parsing when its stamp is unchanged but still checks PNG stamp', () => {
  assert.match(rendererHeader, /std::string radarJsonStamp_/);
  assert.match(renderer, /const std::string jsonStamp = file::Stamp\(radarJsonPath\)/);
  assert.match(renderer, /jsonUnchanged = radarFrameBitmap_ && radarJsonStamp_ == jsonStamp/);
  assert.match(renderer, /if \(jsonUnchanged\) \{\s*framePath = RepresentativeRadarLocalPath\(dataDir_\);/s);
  assert.match(renderer, /const std::string stamp = file::Stamp\(\*framePath\)/);
});

test('all three radar panels render only an enlarged timestamp chip', () => {
  assert.match(browserFrame, /const chipTop = 70;/);
  assert.match(browserFrame, /panelWidth - chipLeft \* 2/);
  assert.match(browserFrame, /context\.roundRect\(panelX \+ chipLeft, chipTop/);
  assert.match(browserFrame, /context\.font = "500 39px sans-serif"/);
  assert.match(browserFrame, /const timeWidth = context\.measureText\(timeText\)\.width;/);
  assert.match(browserFrame, /chipTop \+ chipHeight \/ 2/);
  assert.doesNotMatch(browserFrame, /\btitle\b/);
  assert.doesNotMatch(cloud, /title:/);
  assert.doesNotMatch(cloud, /現在|1時間後|取得可能な最後/);
  assert.match(browserFrame, /context\.fillStyle = "rgba\(0,0,0,0\.92\)"/);
  assert.match(browserFrame, /context\.fillRect\(divider \* panelWidth - 1, 0, 3, payload\.outputHeight\)/);
});