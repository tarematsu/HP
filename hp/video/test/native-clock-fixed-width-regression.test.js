import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const layout = readFileSync(
  new URL('../../native/src/renderer_panels/layout_overrides.inc', import.meta.url),
  'utf8',
);

test('clock time keeps a stable width when narrow digits are displayed', () => {
  assert.match(layout, /void DrawFixedWidthClockTime/);
  assert.match(layout, /for \(wchar_t digit = L'0'; digit <= L'9'; \+\+digit\)/);
  assert.match(layout, /digitCellWidth = std::max\(digitCellWidth, extent\.cx\)/);
  assert.match(layout, /separatorCellWidth = std::max\(1, digitCellWidth \* 45 \/ 100\)/);
  assert.match(
    layout,
    /DrawFixedWidthClockTime\(\(dc\), TimeText\(hpNow\), hpTimeRect\)/,
  );
  assert.doesNotMatch(
    layout,
    /DrawTextInRect\(\(dc\), TimeText\(hpNow\), hpTimeRect/,
  );
});