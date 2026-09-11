import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const browserRadar = readFileSync(
  new URL('../../cloud/src/radar_browser_frame.ts', import.meta.url),
  'utf8',
);
const prepareAssets = readFileSync(
  new URL('../../scripts/prepare-radar-cloud-assets.mjs', import.meta.url),
  'utf8',
);

test('cloud radar keeps rain visible and draws only the Kawagoe outside mask above it', () => {
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

test('missing boundary data never falls back to the opaque legacy map', () => {
  assert.match(browserRadar, /if \(!addBoundaryPath\(panel, panelX\)\)/);
  assert.match(browserRadar, /return false;/);
  assert.match(browserRadar, /drawKawagoeMask\(panel, panelX\);/);
  assert.doesNotMatch(browserRadar, /if \(!drawKawagoeMask/);
});
