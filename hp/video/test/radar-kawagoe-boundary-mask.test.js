import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const browserRadar = readFileSync(
  new URL('../../cloud/src/radar_browser_frame.ts', import.meta.url),
  'utf8',
);

test('cloud radar masks outside Kawagoe and draws only the Kawagoe boundary', () => {
  assert.match(browserRadar, /city\/geojson\/latest\/11201\.geojson/);
  assert.match(browserRadar, /context\.fill\("evenodd"\)/);
  assert.match(browserRadar, /rgba\(96,96,96,0\.68\)/);
  assert.match(browserRadar, /rgba\(255,255,255,0\.98\)/);
  assert.match(browserRadar, /context\.lineWidth = 5/);
  assert.match(browserRadar, /if \(!drawKawagoeMask\(panel, panelX\)\) drawBase\(map, panelX\)/);
});
