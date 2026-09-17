import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardHeader = readFileSync(
  new URL('../../native/src/web_renderer.h', import.meta.url),
  'utf8',
);
const rendererPanels = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
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
    /sections\.weather = RECT\{client\.left, sections\.controls\.bottom \+ gap,[\s\S]*client\.right,[\s\S]*sections\.controls\.bottom \+ gap \+ rowHeight\};/,
  );
});

test('clock, air, electricity and weather use the same pixel dimensions', () => {
  assert.match(rendererPanels, /SplitWeatherRadarMatchedMainSections/);
  assert.match(rendererPanels, /dashboard\.side\.right - dashboard\.side\.left/);
  assert.match(rendererPanels, /const LONG rowHeight = std::max<LONG>\(1, \(sideHeight - sideGap \* 2\) \/ 3\);/);
  assert.match(rendererPanels, /const LONG weatherWidth = std::clamp<LONG>\(\s*sideWidth/);
  assert.match(rendererPanels, /client\.top \+ rowHeight/);
  assert.match(
    rendererPanels,
    /Give Weather exactly the same pixel[\s\S]*width and row height as Clock\/Air\/Electricity/,
  );
});

test('YouTube host is fitted to 16:9 inside the full two-row media cell', () => {
  assert.match(mediaHost, /const LONG totalHeight =/);
  assert.match(mediaHost, /totalHeight \* 16 \/ 9/);
  assert.match(mediaHost, /videoWidth \* 9 \/ 16/);
  assert.match(mediaHost, /const LONG contentLeft =/);
  assert.match(mediaHost, /const LONG contentTop =/);
  assert.doesNotMatch(mediaHost, /statusBounds/);
  assert.match(mediaHost, /videoBounds\.left = contentLeft/);
  assert.match(mediaHost, /videoBounds\.top = contentTop/);
  assert.match(mediaHost, /videoBounds\.right = contentLeft \+ videoWidth/);
  assert.match(mediaHost, /videoBounds\.bottom = contentTop \+ videoHeight/);
});
