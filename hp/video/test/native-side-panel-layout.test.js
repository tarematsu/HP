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

test('media panel uses 50% viewport width and a 16:9 height', () => {
  assert.match(
    dashboardHeader,
    /const int mediaWidth = std::clamp\(clientWidth \/ 2, 1, maxMediaWidth\);/,
  );
  assert.match(
    dashboardHeader,
    /std::clamp\(mediaWidth \* 9 \/ 16, 1, maxMediaHeight\);/,
  );
});

test('weather and air remain swapped and weather matches visible rain radar height', () => {
  assert.match(layoutOverrides, /const int upperMediaHeight = height \* 480 \/ 1000;/);
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
