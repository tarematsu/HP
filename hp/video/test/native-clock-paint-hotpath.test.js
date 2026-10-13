import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = filename => readFileSync(
  new URL('../../native/src/' + filename, import.meta.url), 'utf8');
const layout = source('renderer_panels/layout_overrides.inc');
const panels = source('renderer_panels/windows.inc');
const state = source('renderer_panel_state.cpp');

const section = (text, start, end) => {
  const a = text.indexOf(start);
  const b = text.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'missing section: ' + start);
  return text.slice(a, b);
};

test('one-second clock ticks invalidate only the time rectangle', () => {
  assert.match(state, /clockDayChanged \|\| clockMinuteChanged \|\| clockReadyChanged\s*\? PanelSection::Clock\s*: PanelSection::ClockTime/);
  assert.match(panels, /case PanelSection::ClockTime: rect = ClockTimeRectFromCard\(sections.clock\)/);
});

test('partial time repaint bypasses date, waste and footer drawing', () => {
  const body = section(panels,
    'void Renderer::PaintNativeSide(HWND hwnd) {',
    'void Renderer::PaintNativeMain(HWND hwnd) {');
  const clock = body.slice(body.indexOf('if (IntersectRect('),
    body.indexOf('if (IntersectRect(', body.indexOf('if (IntersectRect(') + 1));
  assert.match(clock, /const RECT timeRegion = ClockTimeRectFromCard\(sections.clock\)/);
  for (const side of ['left', 'top', 'right', 'bottom']) {
    assert.match(clock, new RegExp('scope\\.dirty\\.' + side + '\\s*(?:>=|<=)\\s*timeRegion\\.' + side));
  }
  assert.match(clock, /if \(timeOnly\) \{\s*DrawClockTimeOnly\(scope\.dc, sections\.clock, nativeClockTimeText_\)/);
  assert.match(clock, /else \{\s*DrawClockSection\(scope\.dc, sections\.clock\)/);
  const contained = (dirty, time) => dirty.left >= time.left &&
    dirty.top >= time.top && dirty.right <= time.right &&
    dirty.bottom <= time.bottom;
  const time = { left: 10, top: 20, right: 300, bottom: 150 };
  assert.equal(contained({ ...time }, time), true);
  assert.equal(contained({ left: 10, top: 1, right: 300, bottom: 150 }, time), false);
  assert.equal(contained({ left: 10, top: 20, right: 301, bottom: 150 }, time), false);
});

test('time-only painter preserves full-clock font sizing and bounds', () => {
  const fast = section(layout,
    'void DrawClockTimeOnly(', '#define HP_DRAW_CLOCK_WITH_STATUS(');
  const full = section(layout,
    '#define HP_DRAW_CLOCK_WITH_STATUS(', '} while (false)');
  assert.match(fast, /DrawSectionCard\(dc, card\)/);
  assert.match(fast, /content\.top \+ SpanY\(content, 170\)/);
  assert.match(fast, /content\.top \+ SpanY\(content, 650\)/);
  assert.match(full, /SpanY\(hpClockContent, 170\)/);
  assert.match(full, /SpanY\(hpClockContent, 650\)/);
  assert.match(fast, /std::min\(height \* 72 \/ 100, width \* 18 \/ 100\), 32, 88/);
  assert.match(full, /std::min\(hpTimeHeight \* 72 \/ 100, hpTimeWidth \* 18 \/ 100\), 32, 88/);
  assert.match(fast, /CachedUiFont\(fontHeight, FW_SEMIBOLD\)/);
  assert.match(fast, /DrawFixedWidthClockTime\(dc, timeText, timeRect\)/);
  assert.doesNotMatch(fast, /DrawCourse36ClockWasteNotices|hpVersionText|nativeClockDateText_/);
});

test('fixed-width clock caches ten digit measurements per selected font', () => {
  const digits = section(layout,
    'void DrawFixedWidthClockTime(', 'void DrawClockTimeOnly(');
  assert.match(digits, /static thread_local std::map<HGDIOBJ, int> digitWidthByFont/);
  assert.match(digits, /GetCurrentObject\(dc, OBJ_FONT\)/);
  assert.match(digits, /digitWidthByFont\.find\(font\)/);
  assert.match(digits, /if \(cached != digitWidthByFont\.end\(\)\)/);
  assert.match(digits, /for \(wchar_t digit = L'0'; digit <= L'9'; \+\+digit\)/);
  assert.match(digits, /GetTextExtentPoint32W\(dc, &digit, 1, &extent\)/);
  assert.match(digits, /digitWidthByFont\.emplace\(font, digitCellWidth\)/);
  assert.match(digits, /digitCellWidth \* 45 \/ 100/);
});
