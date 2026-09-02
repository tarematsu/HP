import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/power_saving_controller.cpp', import.meta.url),
  'utf8',
);

test('power saving button stays in the clock footer and uses a compact pill', () => {
  assert.match(source, /contentHeight \* 830 \/ 1000/);
  assert.match(source, /contentWidth \* 220 \/ 1000, 78, 112/);
  assert.match(source, /statusHeight \* 58 \/ 100, 22, 30/);
  assert.doesNotMatch(source, /contentHeight \* 735 \/ 1000/);
});

test('compact power saving overlay is clipped to the pill shape', () => {
  assert.match(source, /const bool compact = !powerSaving_ \|\| mvStartupInputPass_/);
  assert.match(source, /CreateRoundRectRgn\(0, 0, width \+ 1, height \+ 1/);
  assert.match(source, /SetWindowRgn\(overlay_, region, TRUE\)/);
  assert.match(source, /SetWindowRgn\(overlay_, nullptr, TRUE\)/);
});

test('MV startup input pass uses overlay-local button coordinates', () => {
  assert.match(
    source,
    /if \(powerSaving_ && !mvStartupInputPass_\) return ParentButtonRect\(\);/,
  );
});
