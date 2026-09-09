import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const renderer = readFileSync(
  new URL('../../native/src/renderer_radar_ui.cpp', import.meta.url),
  'utf8',
);
const migration = readFileSync(
  new URL('../../native/src/radar_cache_migration.cpp', import.meta.url),
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

test('native radar only decodes one 1920x1280 representative PNG', () => {
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
  assert.match(migration, /\"precomposed\":true/);
  assert.match(migration, /representative\/latest\.png/);
  assert.match(migration, /one cloud-composited dual-panel frame/);
  assert.match(migration, /fs::remove\(radarJson/);
  assert.match(migration, /radar-frame\.bmp/);
  assert.match(migration, /radar-frame\.signature/);
});

test('cloud radar contract remains one precomposed representative frame', () => {
  assert.match(cloud, /const RADAR_OUTPUT_WIDTH = 1920/);
  assert.match(cloud, /const RADAR_OUTPUT_HEIGHT = 1280/);
  assert.match(cloud, /RADAR_FRAME_PATH = "\/v1\/radar\/frame\/representative\/latest\.png"/);
  assert.match(cloud, /precomposed: true/);
  assert.match(cloud, /frames: \[frame\]/);
  assert.match(cloud, /one cloud-composited dual-panel frame/);
});
