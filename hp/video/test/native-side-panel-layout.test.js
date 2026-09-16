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

test('clock shares the left top column with a side-by-side air and energy row', () => {
  assert.match(
    dashboardHeader,
    /layout\.side = RECT\{inner\.left, inner\.top, inner\.left \+ sideWidth,[\s\S]*inner\.top \+ mediaHeight\};/,
  );
  assert.match(layoutOverrides, /const int utilityWidth = std::max\(2, width - gapX\);/);
  assert.match(layoutOverrides, /const int airWidth = std::max\(1, utilityWidth \/ 2\);/);
  assert.match(
    layoutOverrides,
    /sections\.clock = RECT\{[\s\S]*client\.left, client\.top, client\.right, client\.top \+ clockHeight\};/,
  );
  assert.match(
    layoutOverrides,
    /sections\.controls = RECT\{[\s\S]*client\.left, utilityTop, client\.left \+ airWidth,[\s\S]*utilityTop \+ utilityHeight\};/,
  );
  assert.match(
    layoutOverrides,
    /sections\.weather = RECT\{[\s\S]*sections\.controls\.right \+ gapX, utilityTop, client\.right,[\s\S]*utilityTop \+ utilityHeight\};/,
  );
});

test('lower row spans both columns with weather left and radar matching YouTube width', () => {
  assert.match(
    dashboardHeader,
    /layout\.main = RECT\{inner\.left, inner\.top \+ mediaHeight \+ gapY,[\s\S]*inner\.right, inner\.bottom\};/,
  );
  assert.match(layoutOverrides, /const int gapX = std::max\(6, width \* 11 \/ 972\);/);
  assert.match(
    layoutOverrides,
    /const int mediaWidth = std::clamp\(width \* 500 \/ 972, 1, rowWidth - 1\);/,
  );
  assert.match(layoutOverrides, /const int sideWidth = std::max\(1, rowWidth - mediaWidth\);/);
});
