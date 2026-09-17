import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const routing = readFileSync(
  new URL('../../native/src/power_saving_window_routing.inc', import.meta.url),
  'utf8',
);
const overlay = readFileSync(
  new URL('../../native/src/power_saving_overlay.inc', import.meta.url),
  'utf8',
);
const mediaWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url),
  'utf8',
);

test('routine parent timer ticks do not relayout the top control overlay', () => {
  const start = routing.indexOf('void PowerSavingController::ObserveParentMessage');
  const end = routing.indexOf('void PowerSavingController::Attach(', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const observeParentMessage = routing.slice(start, end);

  assert.doesNotMatch(observeParentMessage, /case WM_TIMER:/);
  assert.match(observeParentMessage, /case WM_SIZE:/);
  assert.match(observeParentMessage, /case WM_WINDOWPOSCHANGED:/);
  assert.match(observeParentMessage, /case WM_SHOWWINDOW:/);
});

test('unchanged control overlay geometry does not trigger repaint work', () => {
  assert.match(overlay, /ChildBoundsMatch\(overlay_, target\)/);
  assert.match(overlay, /GetWindow\(overlay_, GW_HWNDPREV\) == nullptr/);
  assert.match(
    overlay,
    /if \(!boundsMatch \|\| !zOrderMatch \|\| !visible\) \{[\s\S]*SetWindowPos/,
  );
  assert.match(
    overlay,
    /if \(!boundsMatch\) \{[\s\S]*SetWindowRgn[\s\S]*InvalidateRect\(overlay_, nullptr, FALSE\)/,
  );
});

test('control gaps use the same native panel surface instead of black', () => {
  assert.match(overlay, /kControlOverlayBackground = RGB\(20, 26, 36\)/);
  assert.match(overlay, /ControlOverlayBackgroundBrush\(\)/);
  assert.match(
    overlay,
    /FillRect\(paintDc, &client, ControlOverlayBackgroundBrush\(\)\)/,
  );
  assert.doesNotMatch(overlay, /FillRect\([\s\S]{0,80}BLACK_BRUSH/);
});

test('top controls remain back buffered after media status-strip removal', () => {
  assert.match(overlay, /CreateCompatibleDC\(dc\)/);
  assert.match(overlay, /CreateCompatibleBitmap\(dc, width, height\)/);
  assert.match(overlay, /BitBlt\(dc, 0, 0, width, height, paintDc, 0, 0, SRCCOPY\)/);

  assert.match(mediaWindow, /case WM_ERASEBKGND:[\s\S]*return 1/);
  assert.doesNotMatch(mediaWindow, /HomePanelNativeSpotifyStatus/);
  assert.doesNotMatch(mediaWindow, /CreateCompatibleDC\(dc\)/);
});
