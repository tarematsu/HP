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

test('cloud radar always uses the pre-generated Kawagoe gray-mask map as the top map layer', () => {
  assert.match(browserRadar, /const MAP_ASSET_PATH = "\/radar-cloud\/radar-map\.png";/);
  assert.match(prepareAssets, /"radar-map\.png"/);
  assert.doesNotMatch(browserRadar, /11201\.geojson|fetchKawagoeBoundary|drawKawagoeMask|fill\("evenodd"\)/);

  const satellite = browserRadar.indexOf('drawBase(satellite, panel, panelX);');
  const rain = browserRadar.indexOf('for (const tile of panel.tiles');
  const map = browserRadar.indexOf('drawBase(map, panel, panelX);');
  const label = browserRadar.indexOf('drawPanelLabel(panel, panelX);');

  assert.ok(satellite >= 0, 'satellite layer draw is missing');
  assert.ok(rain > satellite, 'rain must be drawn after satellite');
  assert.ok(map > rain, 'pre-generated gray map must be drawn after rain');
  assert.ok(label > map, 'date/time label must be drawn after every image layer');
});
