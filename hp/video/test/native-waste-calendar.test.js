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
const calendar = readFileSync(
  new URL('../../native/src/renderer_panels/waste_calendar_section.inc', import.meta.url),
  'utf8',
);
const mvPanel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('course 36 schedule remains isolated from the direct media page', () => {
  assert.match(rendererPanels, /waste_calendar_section\.inc/);
  assert.match(rendererPanels, /media_section\.inc/);
  assert.doesNotMatch(mvPanel, /BuildCourse36WasteScheduleJson\(\)/);
  assert.doesNotMatch(mvPanel, /Course36WasteForDate\(date\)/);
  assert.doesNotMatch(mvPanel, /__COURSE36_SCHEDULE__/);
});

test('waste calendar summary is rendered below the clock instead of on the radar', () => {
  assert.match(calendar, /Course36ClockWasteSummary\(const SYSTEMTIME& now\)/);
  assert.doesNotMatch(calendar, /DrawCourse36WasteCalendarOverlay/);
  assert.doesNotMatch(calendar, /DrawCardOutlineWithWasteCalendarOverlay/);
  assert.doesNotMatch(rendererPanels, /DrawCardOutlineWithWasteCalendarOverlay/);
  assert.match(layout, /hpWasteText = Course36ClockWasteSummary\(hpNow\)/);
  assert.match(layout, /hpWasteRect\{hpClockContent\.left, hpTimeRect\.bottom/);
  assert.match(
    layout,
    /hpWasteText[\s\S]*TierFont\(FontTier::Medium\)[\s\S]*DrawTextInRect\(\(dc\), hpWasteText, hpWasteRect/,
  );
  assert.match(layout, /hpVersionText = L"アプリバージョン "/);
  assert.match(layout, /TierFont\(FontTier::Small\)/);
});

test('clock waste summary is limited to two non-burnable hazardous, bottles/cans, or paper notices', () => {
  assert.match(calendar, /BottlesCansPet: return L"びんかん"/);
  assert.match(calendar, /NonBurnableHazardous: return L"不燃有害"/);
  assert.match(calendar, /Paper: return L"紙類"/);
  assert.doesNotMatch(calendar, /L"可燃"|L"プラ"|L"布類"/);
  assert.match(calendar, /foundCount < 2/);
  assert.doesNotMatch(calendar, /foundCount < 3/);
  assert.match(
    calendar,
    /swprintf_s\(item, L"%d日後 %ls", offset, Course36ClockWasteLabel\(kind\)\)/,
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

test('waste calendar data is not duplicated into the direct media page', () => {
  assert.doesNotMatch(mvPanel, /static_cast<unsigned>\(Course36WasteForDate\(date\)\)/);
  assert.doesNotMatch(mvPanel, /Course36AddDays\(date, 1, next\)/);
  assert.doesNotMatch(mvPanel, /2026, 7, \{2, 16, 30\}/);
});
