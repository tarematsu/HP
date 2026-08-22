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

test('native build crops and precomposes satellite and map before embedding one radar asset', () => {
  assert.match(buildRadarBase, /\$satelliteImage\.Width \* 0\.4/);
  assert.match(buildRadarBase, /\$satelliteImage\.Height \* 0\.4/);
  assert.match(buildRadarBase, /\$cropLeft = \[int\]\[Math\]::Floor/);
  assert.match(buildRadarBase, /\$cropTop = \[int\]\[Math\]::Floor/);
  assert.match(buildRadarBase, /DrawImage\(\$satelliteImage/);
  assert.match(buildRadarBase, /DrawImage\(\$mapImage/);

  assert.match(cmake, /set\(HOMEPANEL_RADAR_BASE .*generated\/radar-base\.png/);
  assert.match(cmake, /build-radar-base\.ps1/);
  assert.match(cmake, /-DHOMEPANEL_RADAR_BASE=\$\{HOMEPANEL_RADAR_BASE\}/);
  assert.match(resource, /110 RCDATA "@HOMEPANEL_RADAR_BASE@"/);
  assert.doesNotMatch(resource, /112 RCDATA/);
});

test('runtime installs and decodes only the cropped precomposed base', () => {
  assert.match(embeddedUi, /\{110, L"radar-base\.png"\}/);
  assert.doesNotMatch(embeddedUi, /\{112,/);
  assert.match(embeddedUi, /L"radar-satellite\.png"/);
  assert.match(embeddedUi, /L"radar-map\.png"/);

  assert.match(radarUi, /constexpr int kRadarBaseWidth = 768;/);
  assert.match(radarUi, /constexpr int kRadarBaseHeight = 512;/);
  assert.match(radarUi, /uiDir \/ L"radar-base\.png"/);
  assert.match(radarUi, /CachedRadarBitmap\(\s*L"radar-base", basePath, baseStamp, kRadarBaseWidth, kRadarBaseHeight\)/s);
  assert.doesNotMatch(radarUi, /radar-satellite\.png/);
  assert.doesNotMatch(radarUi, /radar-map\.png/);
  assert.match(radarUi, /CachedRadarBitmap\(L"radar-tile:" \+ tile\.url, tile\.path,[\s\S]*256, 256\)/);
});