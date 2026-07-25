import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rendererPanels = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const layout = readFileSync(
  new URL('../../native/src/renderer_panels/layout_overrides.inc', import.meta.url),
  'utf8',
);
const panelWindows = readFileSync(
  new URL('../../native/src/renderer_panels/windows.inc', import.meta.url),
  'utf8',
);
const calendar = readFileSync(
  new URL('../../native/src/renderer_panels/waste_calendar_section.inc', import.meta.url),
  'utf8',
);
const panelState = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);

test('native dashboard loads the course 36 calendar before panel painting', () => {
  assert.match(
    rendererPanels,
    /layout_overrides\.inc"\s*#include "renderer_panels\/waste_calendar_section\.inc"[\s\S]*windows\.inc"/,
  );
  assert.match(panelWindows, /DrawCourse36WasteCalendar\(scope\.dc, wasteCalendar\)/);
});

test('Spotify music card occupies the lower half while electricity keeps the right column', () => {
  assert.match(layout, /const int musicHeight = std::max\(1, height \/ 2\);/);
  assert.match(
    layout,
    /layout\.sections\.music =\s*RECT\{client\.left, musicTop, client\.left \+ leftWidth, client\.bottom\};/s,
  );
  assert.match(
    layout,
    /layout\.wasteCalendar =\s*RECT\{client\.left, client\.top, client\.left \+ leftWidth, calendarBottom\};/s,
  );
  assert.match(
    layout,
    /layout\.sections\.air =\s*RECT\{layout\.sections\.music\.right \+ gapX, client\.top, client\.right, client\.bottom\};/s,
  );
});

test('course 36 fiscal-year table includes the published July week', () => {
  assert.match(calendar, /\{2026, 7, \{2, 16, 30\}, 3, 23, \{9, 0\}, 1, 27\}/);
  assert.match(calendar, /収集コース36・令和8年度/);
  assert.match(calendar, /びん・かん/);
  assert.match(calendar, /ペットボトル/);
  assert.match(calendar, /不燃・有害/);
  assert.match(calendar, /プラ製容器/);
});

test('weekly rules and year-end exceptions follow the published course 36 notes', () => {
  assert.match(calendar, /date\.wDayOfWeek == 2 \|\| date\.wDayOfWeek == 5/);
  assert.match(calendar, /dateKey == 20270101/);
  assert.match(calendar, /date\.wDayOfWeek == 3/);
  assert.match(calendar, /dateKey == 20261230/);
  assert.match(calendar, /dateKey < 20260401 \|\| dateKey > 20270331/);
});

test('calendar refreshes at the local day boundary', () => {
  assert.match(
    panelState,
    /if \(clockDayChanged && nativeMainWindow_[\s\S]*InvalidateRect\(nativeMainWindow_, nullptr, FALSE\);/s,
  );
});
