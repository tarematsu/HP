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
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url),
  'utf8',
);
const embeddedUi = readFileSync(
  new URL('../../native/src/embedded_ui.cpp', import.meta.url),
  'utf8',
);
const nativeResources = readFileSync(
  new URL('../../native/resources/HomePanel.rc.in', import.meta.url),
  'utf8',
);

test('course 36 schedule remains isolated from the direct media page', () => {
  assert.match(rendererPanels, /waste_calendar_section\.inc/);
  assert.match(rendererPanels, /media_section\.inc/);
  assert.doesNotMatch(mvPanel, /BuildCourse36WasteScheduleJson\(\)/);
  assert.doesNotMatch(mvPanel, /Course36WasteForDate\(date\)/);
  assert.doesNotMatch(mvPanel, /__COURSE36_SCHEDULE__/);
});

test('waste collection strip is rendered below the clock instead of on the radar', () => {
  assert.match(calendar, /DrawCourse36ClockWasteNotices\(/);
  assert.doesNotMatch(calendar, /DrawCourse36WasteCalendarOverlay/);
  assert.doesNotMatch(calendar, /DrawCardOutlineWithWasteCalendarOverlay/);
  assert.doesNotMatch(rendererPanels, /DrawCardOutlineWithWasteCalendarOverlay/);
  assert.match(layout, /DrawCourse36ClockWasteNotices\(\(dc\), hpWasteNow, hpWasteRect\)/);
  assert.match(layout, /nativeClockReady_/);
  assert.match(layout, /hpWasteRect\{hpClockContent\.left, hpTimeRect\.bottom/);
  assert.doesNotMatch(layout, /Course36ClockWasteSummary|hpWasteText/);
  assert.match(layout, /const std::wstring hpVersionText = kVersion;/);
  assert.doesNotMatch(layout, /L"アプリバージョン "/);
  assert.match(layout, /TierFont\(FontTier::Small\)/);
});

test('clock waste strip always contains three dated illustrated target categories', () => {
  assert.match(calendar, /std::array<Course36ClockWasteNotice, 3>/);
  assert.match(calendar, /std::array<Course36WasteKind, 3> kCourse36ClockWasteKinds/);
  assert.match(calendar, /Course36WasteKind::BottlesCansPet/);
  assert.match(calendar, /Course36WasteKind::NonBurnableHazardous/);
  assert.match(calendar, /Course36WasteKind::Paper/);
  assert.match(calendar, /foundCount < 3/);
  assert.doesNotMatch(calendar, /foundCount < 2/);
  assert.match(calendar, /L"--\/--"/);
  assert.match(calendar, /L"%u\/%u"/);
  assert.doesNotMatch(calendar, /日後/);
  assert.match(calendar, /bottles-cans\.png/);
  assert.match(calendar, /nonburnable-hazardous\.png/);
  assert.match(calendar, /paper\.png/);
  assert.match(calendar, /DecodeImageFileToBitmap\(/);
  assert.doesNotMatch(calendar, /WinHttpDownload\(/);
  assert.match(calendar, /DrawCourse36WasteFallbackPictogram\(/);
});

test('cropped waste illustrations are bundled for offline rendering', () => {
  for (const [id, name] of [
    [120, 'bottles-cans.png'],
    [121, 'nonburnable-hazardous.png'],
    [122, 'paper.png'],
  ]) {
    assert.match(embeddedUi, new RegExp(`\\{${id}, L"waste-icons/${name.replace('.', '\\.')}"\\}`));
    assert.match(nativeResources, new RegExp(`${id} RCDATA`));
    const bytes = readFileSync(new URL(`../../native/scripts/ui/waste-icons/${name}`, import.meta.url));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  }
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
