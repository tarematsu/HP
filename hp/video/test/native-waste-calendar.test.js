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
const mvPanel = readFileSync(
  new URL('../../native/src/renderer_panels/mv_section.inc', import.meta.url),
  'utf8',
);

test('course 36 schedule is loaded before the MV wrapper that consumes it', () => {
  assert.match(
    rendererPanels,
    /waste_calendar_section\.inc"[\s\S]*mv_section\.inc"/,
  );
  assert.match(mvPanel, /BuildCourse36WasteScheduleJson\(\)/);
  assert.match(mvPanel, /Course36WasteForDate\(date\)/);
  assert.match(mvPanel, /__COURSE36_SCHEDULE__/);
});

test('standalone waste panel is removed and radar fills the full left column', () => {
  assert.doesNotMatch(panelWindows, /DrawCourse36WasteCalendar/);
  assert.doesNotMatch(panelWindows, /RearrangedWasteCalendarRect/);
  assert.doesNotMatch(layout, /wasteCalendar/);
  assert.doesNotMatch(layout, /RearrangedWasteCalendarRect/);
  assert.match(
    layout,
    /layout\.sections\.music =\s*RECT\{client\.left, client\.top, client\.left \+ leftWidth, client\.bottom\};/s,
  );
  assert.match(
    layout,
    /layout\.sections\.air =\s*RECT\{layout\.sections\.music\.right \+ gapX, client\.top, client\.right, client\.bottom\};/s,
  );
});

test('course 36 fiscal-year table includes the published July week', () => {
  assert.match(calendar, /\{2026, 7, \{2, 16, 30\}, 3, 23, \{9, 0\}, 1, 27\}/);
  assert.match(calendar, /2026-04-01 through 2027-03-31/);
});

test('weekly rules and year-end exceptions follow the published course 36 notes', () => {
  assert.match(calendar, /date\.wDayOfWeek == 2 \|\| date\.wDayOfWeek == 5/);
  assert.match(calendar, /dateKey == 20270101/);
  assert.match(calendar, /date\.wDayOfWeek == 3/);
  assert.match(calendar, /dateKey == 20261230/);
  assert.match(calendar, /dateKey < 20260401 \|\| dateKey > 20270331/);
});

test('waste calendar data remains schedule-driven instead of duplicated in JavaScript', () => {
  assert.match(mvPanel, /static_cast<unsigned>\(Course36WasteForDate\(date\)\)/);
  assert.match(mvPanel, /Course36AddDays\(date, 1, next\)/);
  assert.doesNotMatch(mvPanel, /2026, 7, \{2, 16, 30\}/);
});
