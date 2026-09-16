import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const browserRadar = readFileSync(
  new URL('../../cloud/src/radar_browser_frame.ts', import.meta.url),
  'utf8',
);
const radarSource = readFileSync(
  new URL('../../cloud/src/radar_source.ts', import.meta.url),
  'utf8',
);
const radarTile = readFileSync(
  new URL('../../cloud/src/radar_tile.ts', import.meta.url),
  'utf8',
);

test('cloud radar clips every panel before drawing partial edge tiles', () => {
  assert.match(
    browserRadar,
    /context\.save\(\);[\s\S]*context\.rect\(panelX, 0, panelWidth, payload\.outputHeight\);[\s\S]*context\.clip\(\);[\s\S]*for \(const tile of panel\.tiles[\s\S]*context\.restore\(\);/,
  );
});

test('cloud radar composes z10 tiles at 1:1 output pixel scale', () => {
  assert.match(radarSource, /const RADAR_PANEL_SOURCE_WIDTH = 432;/);
  assert.match(radarSource, /const RADAR_PANEL_SOURCE_HEIGHT = 729;/);
  assert.match(radarSource, /const RADAR_BASE_CROP_WIDTH = 432;/);
  assert.match(radarSource, /const RADAR_BASE_CROP_HEIGHT = 729;/);
  assert.match(radarSource, /const RADAR_OUTPUT_WIDTH = 1296;/);
  assert.match(radarSource, /const RADAR_OUTPUT_HEIGHT = 729;/);
  assert.match(browserRadar, /panel\.sourceWidth !== panelWidth/);
  assert.match(browserRadar, /panel\.sourceHeight !== payload\.outputHeight/);
  assert.match(browserRadar, /must match output pixels at 1:1 scale/);
});

test('cloud radar uses the same z10 XYZ/WebMercator layout for JMA tiles and panel projection', () => {
  assert.match(radarSource, /const RADAR_DISPLAY_ZOOM = 10;/);
  assert.match(radarSource, /Math\.floor\(left \/ 256\)/);
  assert.match(radarSource, /Math\.floor\(top \/ 256\)/);
  assert.match(radarSource, /destX: Math\.round\(x \* 256 - left\)/);
  assert.match(radarSource, /destY: Math\.round\(y \* 256 - top\)/);
  assert.match(radarTile, /data\/nowc\/\$\{baseTime\}\/none\/\$\{validTime\}\/surf\/hrpns\/\$\{coordinates\.zoom\}\/\$\{coordinates\.x\}\/\$\{coordinates\.y\}\.png/);
  assert.match(radarTile, /data\/rasrf\/\$\{baseTime\}\/none\/\$\{validTime\}\/surf\/rasrf\/\$\{coordinates\.zoom\}\/\$\{coordinates\.x\}\/\$\{coordinates\.y\}\.png/);
});