import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const energyRenderer = readFileSync(
  new URL('../../native/src/renderer_panels/data_sections.inc', import.meta.url),
  'utf8',
);

test('energy chart reserves enough width for two-digit decimal axis labels', () => {
  assert.match(energyRenderer, /const int yLabelWidth = std::max\(44, SpanX\(body, 120\)\);/);
  assert.match(energyRenderer, /const int labelRight = plot\.left - SpanX\(body, 6\);/);
  assert.match(energyRenderer, /RECT maxLabel\{chart\.left,[\s\S]*?labelRight,/);
});

test('energy chart labels the midpoint between zero and the daily maximum', () => {
  assert.match(
    energyRenderer,
    /const int middleY = plot\.top \+ \(plot\.bottom - plot\.top\) \/ 2;/,
  );
  assert.match(
    energyRenderer,
    /DrawTextInRect\(dc, Fixed\(maximum \/ 2\.0, axisPrecision\), middleLabel,/,
  );
  assert.match(energyRenderer, /DrawTextInRect\(dc, L"0", zeroLabel,/);
});
