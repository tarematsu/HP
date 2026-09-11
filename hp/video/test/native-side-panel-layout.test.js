import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardHeader = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url),
  'utf8',
);
const layoutOverrides = readFileSync(
  new URL('../../native/src/renderer_panels/layout_overrides.inc', import.meta.url),
  'utf8',
);

test('weather and air are swapped and weather matches visible rain radar height', () => {
  assert.match(dashboardHeader, /const int radarHeight = innerHeight \* 600 \/ 1000;/);
  assert.match(layoutOverrides, /const int upperMediaHeight = height \* 600 \/ 1000;/);
  assert.match(
    layoutOverrides,
    /const int weatherHeight =\s*std::max\(1, height - upperMediaHeight - gap\);/,
  );
  assert.match(
    layoutOverrides,
    /sections\.clock = RECT[\s\S]*sections\.controls = RECT[\s\S]*sections\.weather = RECT/,
  );
  assert.match(
    layoutOverrides,
    /sections\.weather = RECT\{client\.left, top, client\.right, top \+ weatherHeight\};/,
  );
});