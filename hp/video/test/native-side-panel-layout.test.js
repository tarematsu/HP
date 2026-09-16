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
