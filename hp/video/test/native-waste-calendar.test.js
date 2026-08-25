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

test('course 36 schedule remains isolated from the direct YouTube MV page', () => {
  assert.match(rendererPanels, /waste_calendar_section\.inc/);
  assert.match(rendererPanels, /media_section\.inc/);
  assert.doesNotMatch(mvPanel, /BuildCourse36WasteScheduleJson\(\)/);
  assert.doesNotMatch(mvPanel, /Course36WasteForDate\(date\)/);
  assert.doesNotMatch(mvPanel, /__COURSE36_SCHEDULE__/);
});

test('waste calendar overlays the visible radar card rather than the YouTube host', () => {
  assert.match(calendar, /DrawCourse36WasteCalendarOverlay\(HDC dc, const RECT& bounds\)/);
  assert.match(calendar, /DrawCardOutlineWithWasteCalendarOverlay/);
  assert.match(calendar, /bounds\.right - margin - panelWidth/);
  assert.match(calendar, /bounds\.top \+ margin/);
  assert.match(
    rendererPanels,
    /#define DrawCardOutline DrawCardOutlineWithWasteCalendarOverlay[\s\S]*media_section\.inc/,
  );
  assert.doesNotMatch(
    rendererPanels,
    /#define DrawCardOutline DrawCardOutlineWithWasteCalendarOverlay[\s\S]*windows\.inc/,
  );
  assert.match(mvPanel, /void Renderer::DrawMusicSection/);
  assert.match(mvPanel, /DrawCardOutline\(dc, bounds, radius\)/);
  assert.match(panelWindows, /DrawCardOutline\(scope\.dc, bounds, radius\)/);
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

test('radar overlay shows only today and tomorrow using the existing rules', () => {
  assert.match(calendar, /for \(int index = 0; index < 2; \+\+index\)/);
  assert.match(calendar, /Course36AddDays\(now, index, date\)/);
  assert.match(calendar, /kDayLabels\[\] = \{L"今日", L"明日"\}/);
  assert.match(calendar, /Course36WasteLabel\(Course36WasteForDate\(date\)\)/);
  assert.match(calendar, /ごみ収集  コース36/);
  assert.doesNotMatch(calendar, /weekStart/);
});

test('waste calendar data is not duplicated into the direct YouTube page', () => {
  assert.doesNotMatch(mvPanel, /static_cast<unsigned>\(Course36WasteForDate\(date\)\)/);
  assert.doesNotMatch(mvPanel, /Course36AddDays\(date, 1, next\)/);
  assert.doesNotMatch(mvPanel, /2026, 7, \{2, 16, 30\}/);
});
