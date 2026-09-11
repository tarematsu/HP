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

test('native radar only decodes one 1440x960 representative PNG', () => {
  assert.match(rendererHeader, /kRadarCanvasWidth = 1440/);
  assert.match(rendererHeader, /kRadarCanvasHeight = 960/);
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
  assert.match(radarCache, /width != 1440 \|\| height != 960/);
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

test('cloud radar contract remains one reduced precomposed three-panel representative frame', () => {
  assert.match(cloud, /const RADAR_OUTPUT_WIDTH = 1440/);
  assert.match(cloud, /const RADAR_OUTPUT_HEIGHT = 960/);
  assert.match(cloud, /const RADAR_BASE_ZOOM = 10/);
  assert.match(cloud, /const RADAR_DISPLAY_ZOOM = 9/);
  assert.match(cloud, /const RADAR_PANEL_SOURCE_WIDTH = 320/);
  assert.match(cloud, /const RADAR_PANEL_SOURCE_HEIGHT = 640/);
  assert.match(cloud, /const RADAR_BASE_CROP_WIDTH = 640/);
  assert.match(cloud, /const RADAR_BASE_CROP_HEIGHT = 1280/);
  assert.match(cloud, /RADAR_FRAME_PATH = "\/v1\/radar\/frame\/representative\/latest\.png"/);
  assert.match(cloud, /JMA_SHORT_TERM_TIMES_URL/);
  assert.match(cloud, /panelRequest\(env, panelMetadata\[0\]\.title, "jma"/);
  assert.match(cloud, /panelRequest\(env, panelMetadata\[1\]\.title, "jma"/);
  assert.match(cloud, /panelRequest\(env, panelMetadata\[2\]\.title, "rasrf"/);
  assert.match(cloud, /precomposed: true/);
  assert.match(cloud, /frames: \[frame\]/);
  assert.match(cloud, /one cloud-composited representative frame/);
  assert.match(browserFrame, /payload\.outputWidth \/ payload\.panels\.length/);
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

test('Kawagoe mask is persisted once in R2 and loaded internally as a PNG data URL', () => {
  assert.match(browserFrame, /KAWAGOE_MASK_KEY = "radar\/assets\/kawagoe-mask-v1-480x960\.png"/);
  assert.match(browserFrame, /UPDATE_BUCKET\.get\(KAWAGOE_MASK_KEY\)/);
  assert.match(browserFrame, /storedMask \? null : await fetchKawagoeBoundary\(\)/);
  assert.match(browserFrame, /encodePngDataUrl\(new Uint8Array\(await storedMask\.arrayBuffer\(\)\)\)/);
  assert.match(browserFrame, /kawagoeMaskDataUrl: storedMaskDataUrl/);
  assert.match(browserFrame, /generatedMaskDataUrl = maskCanvas\.toDataURL\("image\/png"\)/);
  assert.match(browserFrame, /UPDATE_BUCKET\.put\(\s*KAWAGOE_MASK_KEY/s);
  assert.doesNotMatch(cloud, /KAWAGOE_MASK_PATH/);
});

test('rain presence analysis uses a quarter-size canvas in each dimension', () => {
  assert.match(browserFrame, /const RAIN_ANALYSIS_WIDTH = 80;/);
  assert.match(browserFrame, /const RAIN_ANALYSIS_HEIGHT = 160;/);
  assert.match(browserFrame, /rainCanvas\.width = payload\.analysisWidth/);
  assert.match(browserFrame, /rainCanvas\.height = payload\.analysisHeight/);
  assert.match(browserFrame, /rainContext\.imageSmoothingEnabled = false/);
});

test('native skips radar JSON parsing when its stamp is unchanged but still checks PNG stamp', () => {
  assert.match(rendererHeader, /std::string radarJsonStamp_/);
  assert.match(renderer, /const std::string jsonStamp = file::Stamp\(radarJsonPath\)/);
  assert.match(renderer, /jsonUnchanged = radarFrameBitmap_ && radarJsonStamp_ == jsonStamp/);
  assert.match(renderer, /if \(jsonUnchanged\) \{\s*framePath = RepresentativeRadarLocalPath\(dataDir_\);/s);
  assert.match(renderer, /const std::string stamp = file::Stamp\(\*framePath\)/);
});

test('all three radar labels remain proportional after the reduced frame size', () => {
  assert.match(browserFrame, /const chipTop = 180;/);
  assert.match(browserFrame, /panelWidth - chipLeft \* 2/);
  assert.match(browserFrame, /context\.roundRect\(panelX \+ chipLeft, chipTop/);
  assert.match(browserFrame, /chipTop \+ 25/);
  assert.match(browserFrame, /chipTop \+ 61/);
  assert.match(browserFrame, /context\.fillStyle = "rgba\(0,0,0,0\.92\)";/);
  assert.match(browserFrame, /context\.fillRect\(divider \* panelWidth - 1, 0, 3, payload\.outputHeight\)/);
});
