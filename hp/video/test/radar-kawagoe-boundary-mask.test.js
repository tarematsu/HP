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

test('cloud radar persists one Kawagoe boundary PNG and draws it above every panel', () => {
  assert.match(browserRadar, /city\/geojson\/latest\/11201\.geojson/);
  assert.match(browserRadar, /KAWAGOE_MASK_VERSION = "kawagoe-z10-480x960-native-scale-v4-green-boundary"/);
  assert.match(browserRadar, /UPDATE_BUCKET\.get\(KAWAGOE_MASK_KEY\)/);
  assert.match(browserRadar, /storedMaskObject\?\.customMetadata\?\.version === KAWAGOE_MASK_VERSION/);
  assert.match(browserRadar, /storedMask \? null : await fetchKawagoeBoundary\(\)/);
  assert.doesNotMatch(browserRadar, /maskContext\.fill\("evenodd"\)/);
  assert.doesNotMatch(browserRadar, /rgba\(96,96,96,0\.68\)/);
  assert.doesNotMatch(browserRadar, /rgba\(255,255,255,0\.98\)/);
  assert.match(browserRadar, /rgba\(0,200,0,0\.98\)/);
  assert.match(browserRadar, /maskContext\.lineWidth = 4/);
  assert.match(browserRadar, /generatedMaskDataUrl = maskCanvas\.toDataURL\("image\/png"\)/);
  assert.match(browserRadar, /customMetadata: \{ version: KAWAGOE_MASK_VERSION \}/);
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
  assert.ok(mask > rain, 'Kawagoe boundary must be drawn after rain');
  assert.ok(label > mask, 'date/time label must be drawn after the boundary');
});

test('Kawagoe boundary warmup uses the exact same world-pixel viewport as rain tiles', () => {
  assert.match(cloudRadar, /type RadarViewport = \{ worldLeft: number; worldTop: number; zoom: number \}/);
  assert.match(cloudRadar, /worldLeft: viewport\.worldLeft/);
  assert.match(cloudRadar, /worldTop: viewport\.worldTop/);
  assert.match(cloudRadar, /zoom: viewport\.zoom/);
  assert.match(browserRadar, /const x = \(world\.x - panel\.worldLeft\) \* scaleX;/);
  assert.match(browserRadar, /const y = \(world\.y - panel\.worldTop\) \* scaleY;/);
  assert.match(browserRadar, /worldPixel\(lon, lat, panel\.zoom\)/);
  assert.doesNotMatch(browserRadar, /tileReference/);
});

test('every radar panel is generated without dry or sunny classification', () => {
  assert.doesNotMatch(browserRadar, /SUNNY_ICON_ASSET_PATH|sunnyIcon|drawNoRainPanel/);
  assert.doesNotMatch(browserRadar, /RAIN_ANALYSIS_WIDTH|RAIN_ANALYSIS_HEIGHT/);
  assert.doesNotMatch(browserRadar, /rainCanvas|rainContext|getImageData|hasRain|rainPixels/);
  assert.doesNotMatch(prepareAssets, /radar-sunny\.png|weather-sunny\.png/);
  assert.match(browserRadar, /for \(const tile of panel\.tiles/);
  assert.match(browserRadar, /if \(!bitmap\) continue;/);
  assert.match(
    browserRadar,
    /context\.drawImage\(\s*bitmap,\s*panelX \+ Math\.round\(tile\.destX \* scaleX\),/s,
  );
  assert.match(
    browserRadar,
    /context\.drawImage\(kawagoeMask, panelX, 0, panelWidth, payload\.outputHeight\);/,
  );
});

test('radar panel labels use the requested top offset and timestamp-only content', () => {
  assert.match(browserRadar, /const chipTop = 70;/);
  assert.match(browserRadar, /context\.font = "500 39px sans-serif"/);
  assert.doesNotMatch(browserRadar, /\btitle\b/);
  assert.doesNotMatch(cloudRadar, /title:/);
  assert.doesNotMatch(cloudRadar, /現在|1時間後|取得可能な最後/);
});

test('missing boundary data never falls back to the opaque legacy map', () => {
  assert.match(browserRadar, /if \(!storedMask && !boundary\) \{/);
  assert.match(browserRadar, /throw new Error\("Kawagoe boundary is unavailable for static radar mask warmup"\)/);
  assert.doesNotMatch(browserRadar, /if \(!drawKawagoeMask/);
  assert.doesNotMatch(browserRadar, /radar-map\.png/);
});
