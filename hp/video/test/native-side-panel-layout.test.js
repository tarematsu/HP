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
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url),
  'utf8',
);

test('left column uses three equal rows and media spans the top two', () => {
  assert.match(dashboardHeader, /const int sideWidth = innerWidth \* 285 \/ 1000;/);
  assert.match(dashboardHeader, /const int rowHeight = std::max\(1, \(innerHeight - gapY \* 2\) \/ 3\);/);
  assert.match(dashboardHeader, /const int mediaHeight = rowHeight \* 2 \+ gapY;/);
  assert.match(dashboardHeader, /const int mainTop = inner\.top \+ mediaHeight \+ gapY;/);
  assert.match(layoutOverrides, /const int rowHeight = std::max\(1, \(height - gap \* 2\) \/ 3\);/);
  assert.match(
    layoutOverrides,
    /sections\.clock = RECT[\s\S]*sections\.controls = RECT[\s\S]*sections\.weather = RECT/,
  );
  assert.match(
    layoutOverrides,
    /sections\.weather = RECT\{client\.left, sections\.controls\.bottom \+ gap,[\s\S]*client\.right, client\.bottom\};/,
  );
});

test('clock, air, electricity and weather keep matching card proportions', () => {
  assert.match(layoutOverrides, /rowWidth \* 588 \/ 1000/);
  assert.match(
    layoutOverrides,
    /Weather receives 41\.2% of the usable right-row width/,
  );
  assert.match(
    layoutOverrides,
    /matches the Clock\/Air\/Electricity card[\s\S]*integer-pixel rounding/,
  );
});

test('YouTube host is fitted to 16:9 inside the two-row media cell', () => {
  assert.match(mediaHost, /const LONG availableVideoHeight =/);
  assert.match(mediaHost, /availableVideoHeight \* 16 \/ 9/);
  assert.match(mediaHost, /videoWidth \* 9 \/ 16/);
  assert.match(mediaHost, /const LONG contentLeft =/);
  assert.match(mediaHost, /statusBounds\.left = contentLeft/);
  assert.match(mediaHost, /statusBounds\.right = contentLeft \+ videoWidth/);
  assert.match(mediaHost, /videoBounds\.left = contentLeft/);
  assert.match(mediaHost, /videoBounds\.right = contentLeft \+ videoWidth/);
});
