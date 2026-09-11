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

test('cloud radar keeps rain visible and draws only the Kawagoe outside mask above wet panels', () => {
  assert.match(browserRadar, /city\/geojson\/latest\/11201\.geojson/);
  assert.match(browserRadar, /fetchKawagoeBoundary/);
  assert.match(browserRadar, /context\.fill\("evenodd"\)/);
  assert.match(browserRadar, /rgba\(96,96,96,0\.68\)/);
  assert.match(browserRadar, /rgba\(255,255,255,0\.98\)/);
  assert.match(browserRadar, /context\.lineWidth = 5/);
  assert.doesNotMatch(browserRadar, /MAP_ASSET_PATH|mapUrl|drawBase\(map/);
  assert.doesNotMatch(prepareAssets, /"radar-map\.png"/);

  const satellite = browserRadar.indexOf('drawBase(satellite, panel, panelX);');
  const rain = browserRadar.indexOf('for (const tile of panel.tiles');
  const mask = browserRadar.indexOf('drawKawagoeMask(panel, panelX);');
  const label = browserRadar.indexOf('drawPanelLabel(panel, panelX);');

  assert.ok(satellite >= 0, 'satellite layer draw is missing');
  assert.ok(rain > satellite, 'rain must be drawn after satellite');
  assert.ok(mask > rain, 'Kawagoe mask must be drawn after rain');
  assert.ok(label > mask, 'date/time label must be drawn after the mask');
});

test('Kawagoe mask uses the exact same world-pixel viewport as rain tiles', () => {
  assert.match(cloudRadar, /type RadarViewport = \{ worldLeft: number; worldTop: number; zoom: number \}/);
  assert.match(cloudRadar, /worldLeft: viewport\.worldLeft/);
  assert.match(cloudRadar, /worldTop: viewport\.worldTop/);
  assert.match(cloudRadar, /zoom: viewport\.zoom/);
  assert.match(browserRadar, /const sourceX = world\.x - panel\.worldLeft;/);
  assert.match(browserRadar, /const sourceY = world\.y - panel\.worldTop;/);
  assert.match(browserRadar, /worldPixel\(lon, lat, panel\.zoom\)/);
  assert.doesNotMatch(browserRadar, /tileReference/);
});

test('each dry radar panel independently becomes gray only when visible rain pixels are absent', () => {
  assert.match(browserRadar, /const SUNNY_ICON_ASSET_PATH = "\/radar-cloud\/weather-sunny\.png";/);
  assert.match(prepareAssets, /weather-icons\/100_day\.png/);
  assert.match(prepareAssets, /weather-sunny\.png/);
  assert.match(browserRadar, /const rainCanvas = g\.document\.createElement\("canvas"\)/);
  assert.match(browserRadar, /rainContext\.getImageData\(0, 0, panel\.sourceWidth, panel\.sourceHeight\)/);
  assert.match(browserRadar, /if \(rainPixels\[offset\] > 8\)/);
  assert.match(browserRadar, /if \(!hasRain\)/);
  assert.match(browserRadar, /await drawNoRainPanel\(panelX\)/);
  assert.match(browserRadar, /rgba\(96,96,96,0\.72\)/);
  assert.match(browserRadar, /context\.fillRect\(panelX, 0, panelWidth, payload\.outputHeight\)/);
  assert.match(browserRadar, /Math\.min\(panelWidth \* 0\.56, payload\.outputHeight \* 0\.30\)/);
  assert.match(browserRadar, /context\.drawImage\(icon, iconX, iconY, iconSize, iconSize\)/);
  assert.match(browserRadar, /sunnyIconUrl: `\$\{publicOrigin\}\$\{SUNNY_ICON_ASSET_PATH\}`/);
  assert.doesNotMatch(browserRadar, /panelRainTiles|loadedRainTiles|radar rain tiles were not fetched for any panel/);
});

test('radar panel labels are placed below the native center-crop safe area', () => {
  assert.match(browserRadar, /const chipTop = 240;/);
});

test('missing boundary data never falls back to the opaque legacy map', () => {
  assert.match(browserRadar, /if \(!addBoundaryPath\(panel, panelX\)\)/);
  assert.match(browserRadar, /return false;/);
  assert.match(browserRadar, /drawKawagoeMask\(panel, panelX\);/);
  assert.doesNotMatch(browserRadar, /if \(!drawKawagoeMask/);
});
