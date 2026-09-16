import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const browserRadar = readFileSync(
  new URL('../../cloud/src/radar_browser_frame.ts', import.meta.url),
  'utf8',
);
const cloudRadar = readFileSync(
  new URL('../../cloud/src/radar_source.ts', import.meta.url),
  'utf8',
);
const prepareAssets = readFileSync(
  new URL('../../scripts/prepare-radar-cloud-assets.mjs', import.meta.url),
  'utf8',
);

test('cloud radar removes the Kawagoe boundary mask path completely', () => {
  assert.doesNotMatch(browserRadar, /11201|KAWAGOE|kawagoe-mask|fetchKawagoeBoundary|boundaryPolygons|addBoundaryPath/);
  assert.doesNotMatch(browserRadar, /generatedMaskDataUrl|maskCanvas|kawagoeMaskDataUrl/);
  assert.doesNotMatch(cloudRadar, /KAWAGOE_MASK_KEY|green-kawagoe-boundary/);
  assert.doesNotMatch(prepareAssets, /"radar-map\.png"/);
});

test('radar location marker is projected from RADAR_CENTER and drawn above rain', () => {
  assert.match(cloudRadar, /const RADAR_CENTER = \{ lat: 35\.8923181, lon: 139\.4858691 \}/);
  assert.match(cloudRadar, /location: RADAR_CENTER/);
  assert.match(cloudRadar, /radar-frame-v12-z10-640x360-downsampled-location-marker-day-cap/);
  assert.match(browserRadar, /const world = worldPixel\(lon, lat, panel\.zoom\)/);
  assert.match(browserRadar, /const x = panelX \+ \(world\.x - panel\.worldLeft\) \* scaleX/);
  assert.match(browserRadar, /const y = \(world\.y - panel\.worldTop\) \* scaleY/);

  const satellite = browserRadar.indexOf('drawBase(satellite, panel, panelX);');
  const rain = browserRadar.indexOf('for (const tile of panel.tiles');
  const marker = browserRadar.indexOf('drawLocationMarker(panel, panelX);');
  const label = browserRadar.indexOf('drawPanelLabel(panel, panelX);');

  assert.ok(satellite >= 0, 'satellite layer draw is missing');
  assert.ok(rain > satellite, 'rain must be drawn after satellite');
  assert.ok(marker > rain, 'location marker must be drawn after rain');
  assert.ok(label > marker, 'date/time label must be drawn after the marker');
});

test('location marker uses a Google Maps-style blue dot with white ring and accuracy halo', () => {
  assert.match(browserRadar, /context\.arc\(x, y, 24, 0, fullCircle\)/);
  assert.match(browserRadar, /rgba\(66,133,244,0\.20\)/);
  assert.match(browserRadar, /context\.arc\(x, y, 13, 0, fullCircle\)/);
  assert.match(browserRadar, /rgba\(255,255,255,0\.98\)/);
  assert.match(browserRadar, /context\.arc\(x, y, 9, 0, fullCircle\)/);
  assert.match(browserRadar, /#4285F4/);
});

test('every radar panel is generated without dry or sunny classification', () => {
  assert.doesNotMatch(browserRadar, /SUNNY_ICON_ASSET_PATH|sunnyIcon|drawNoRainPanel/);
  assert.doesNotMatch(browserRadar, /RAIN_ANALYSIS_WIDTH|RAIN_ANALYSIS_HEIGHT/);
  assert.doesNotMatch(browserRadar, /rainCanvas|rainContext|getImageData|hasRain|rainPixels/);
  assert.doesNotMatch(prepareAssets, /radar-sunny\.png|weather-sunny\.png/);
  assert.match(browserRadar, /for \(const tile of panel\.tiles/);
  assert.match(browserRadar, /if \(!bitmap\) continue;/);
});

test('radar panel labels use the requested top offset and timestamp-only content', () => {
  assert.match(browserRadar, /const chipTop = 70;/);
  assert.match(browserRadar, /context\.font = "500 39px sans-serif"/);
  assert.doesNotMatch(browserRadar, /\btitle\b/);
  assert.doesNotMatch(cloudRadar, /title:/);
  assert.doesNotMatch(cloudRadar, /現在|1時間後|取得可能な最後/);
});