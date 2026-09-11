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

test('cloud radar persists one Kawagoe mask PNG and draws it above wet panels', () => {
  assert.match(browserRadar, /city\/geojson\/latest\/11201\.geojson/);
  assert.match(browserRadar, /const storedMask = env\.UPDATE_BUCKET/);
  assert.match(browserRadar, /storedMask \? null : await fetchKawagoeBoundary\(\)/);
  assert.match(browserRadar, /maskContext\.fill\("evenodd"\)/);
  assert.match(browserRadar, /rgba\(96,96,96,0\.68\)/);
  assert.match(browserRadar, /rgba\(255,255,255,0\.98\)/);
  assert.match(browserRadar, /maskContext\.lineWidth = 4/);
  assert.match(browserRadar, /generatedMaskDataUrl = maskCanvas\.toDataURL\("image\/png"\)/);
  assert.match(browserRadar, /UPDATE_BUCKET\.put\(\s*KAWAGOE_MASK_KEY/s);
  assert.doesNotMatch(browserRadar, /MAP_ASSET_PATH|mapUrl|drawBase\(map/);
  assert.doesNotMatch(prepareAssets, /"radar-map\.png"/);

  const satellite = browserRadar.indexOf('drawBase(satellite, panel, panelX);');
  const rain = browserRadar.indexOf('for (const tile of panel.tiles');
  const mask = browserRadar.indexOf(
    'context.drawImage(kawagoeMask, panelX, 0, panelWidth, payload.outputHeight);',
  );
  const label = browserRadar.indexOf('drawPanelLabel(panel, panelX);');

  assert.ok(satellite >= 0, 'satellite layer draw is missing');
  assert.ok(rain > satellite, 'rain must be drawn after satellite');
  assert.ok(mask > rain, 'Kawagoe mask must be drawn after rain');
  assert.ok(label > mask, 'date/time label must be drawn after the mask');
});

test('Kawagoe mask warmup uses the exact same world-pixel viewport as rain tiles', () => {
  assert.match(cloudRadar, /type RadarViewport = \{ worldLeft: number; worldTop: number; zoom: number \}/);
  assert.match(cloudRadar, /worldLeft: viewport\.worldLeft/);
  assert.match(cloudRadar, /worldTop: viewport\.worldTop/);
  assert.match(cloudRadar, /zoom: viewport\.zoom/);
  assert.match(browserRadar, /const x = \(world\.x - panel\.worldLeft\) \* scaleX;/);
  assert.match(browserRadar, /const y = \(world\.y - panel\.worldTop\) \* scaleY;/);
  assert.match(browserRadar, /worldPixel\(lon, lat, panel\.zoom\)/);
  assert.doesNotMatch(browserRadar, /tileReference/);
});

test('each dry radar panel independently becomes gray after low-resolution alpha analysis', () => {
  assert.match(browserRadar, /const SUNNY_ICON_ASSET_PATH = "\/radar-cloud\/weather-sunny\.png";/);
  assert.match(prepareAssets, /weather-icons\/100_day\.png/);
  assert.match(prepareAssets, /weather-sunny\.png/);
  assert.match(browserRadar, /const RAIN_ANALYSIS_WIDTH = 80;/);
  assert.match(browserRadar, /const RAIN_ANALYSIS_HEIGHT = 160;/);
  assert.match(browserRadar, /const rainCanvas = g\.document\.createElement\("canvas"\)/);
  assert.match(browserRadar, /rainCanvas\.width = payload\.analysisWidth/);
  assert.match(browserRadar, /rainCanvas\.height = payload\.analysisHeight/);
  assert.match(browserRadar, /rainContext\.getImageData\(\s*0, 0, payload\.analysisWidth, payload\.analysisHeight,/s);
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

test('radar panel labels remain below the native center-crop safe area after 0.75 scaling', () => {
  assert.match(browserRadar, /const chipTop = 180;/);
});

test('missing boundary data never falls back to the opaque legacy map', () => {
  assert.match(browserRadar, /if \(!storedMask && !boundary\) \{/);
  assert.match(browserRadar, /throw new Error\("Kawagoe boundary is unavailable for static radar mask warmup"\)/);
  assert.doesNotMatch(browserRadar, /if \(!drawKawagoeMask/);
  assert.doesNotMatch(browserRadar, /radar-map\.png/);
});
