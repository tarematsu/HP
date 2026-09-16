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

test('dashboard uses a balanced 2x2 grid with proportional gaps', () => {
  assert.match(dashboardHeader, /const int marginX = clientWidth \* 14 \/ 1000;/);
  assert.match(dashboardHeader, /const int marginY = clientHeight \* 14 \/ 1000;/);
  assert.match(dashboardHeader, /const int gapX = std::max\(6, clientWidth \* 11 \/ 1000\);/);
  assert.match(dashboardHeader, /const int gapY = std::max\(6, clientHeight \* 11 \/ 1000\);/);
  assert.match(dashboardHeader, /const int sideWidth = std::max\(1, availableWidth \/ 2\);/);
  assert.match(dashboardHeader, /const int topHeight = std::max\(1, availableHeight \/ 2\);/);
  assert.match(
    dashboardHeader,
    /layout\.side = RECT\{inner\.left, inner\.top, inner\.left \+ sideWidth,[\s\S]*inner\.top \+ topHeight\};/,
  );
  assert.match(
    dashboardHeader,
    /layout\.media = RECT\{inner\.left \+ sideWidth \+ gapX, inner\.top,[\s\S]*inner\.top \+ topHeight\};/,
  );
  assert.match(
    dashboardHeader,
    /layout\.main = RECT\{inner\.left, inner\.top \+ topHeight \+ gapY,[\s\S]*inner\.right/,
  );
});

test('clock shares the top-left cell with a side-by-side air and energy row', () => {
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

test('lower row is split evenly between weather and rain radar', () => {
  assert.match(layoutOverrides, /const int gapX = std::max\(6, width \* 11 \/ 972\);/);
  assert.match(layoutOverrides, /const int availableWidth = std::max\(2, width - gapX\);/);
  assert.match(layoutOverrides, /const int weatherWidth = std::max\(1, availableWidth \/ 2\);/);
  assert.match(
    layoutOverrides,
    /const int radarWidth = std::max\(1, width - gapX - weatherWidth\);/,
  );
});
