import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hostWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url),
  'utf8',
);
const mediaSection = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('watchdog timeout recovery stays inside the current media phase', () => {
  const timerCase = hostWindow.slice(
    hostWindow.indexOf('case WM_TIMER:'),
    hostWindow.indexOf('case WM_ERASEBKGND:'),
  );

  assert.match(timerCase, /NativeMediaWatchdogExecutionTimedOut\(hwnd, timerId\)/);
  assert.doesNotMatch(
    timerCase,
    /PostMessageW\(hwnd,\s*kNativeMediaRecreateMessage/,
  );
  assert.match(timerCase, /host->OnTimer\(timerId\)/);
});

test('real WebView process failure can still recreate the media host', () => {
  assert.match(
    mediaSection,
    /add_ProcessFailed[\s\S]*NativeMediaProcessNeedsRecreate[\s\S]*PostMessageW\(hostWindow, kNativeMediaRecreateMessage/,
  );
});
