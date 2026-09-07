import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const windows = readFileSync(
  new URL('../../native/src/renderer_panels/windows.inc', import.meta.url),
  'utf8',
);

test('native clock timer realigns to the next wall-clock second', () => {
  assert.match(
    windows,
    /UINT NativePanelTickDelayToNextSecond\(\) noexcept[\s\S]*GetLocalTime\(&now\)[\s\S]*now\.wMilliseconds/,
  );
  assert.match(
    windows,
    /SetTimer\(nativeMainWindow_, kNativePanelTickTimer,\s*NativePanelTickDelayToNextSecond\(\), nullptr\)/,
  );
  assert.match(
    windows,
    /TickNativePanels\(UnixMillis\(\), true\);[\s\S]*SetTimer\(hwnd, kNativePanelTickTimer,\s*NativePanelTickDelayToNextSecond\(\), nullptr\)/,
  );
});
