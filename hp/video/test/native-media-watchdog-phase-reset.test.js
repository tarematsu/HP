import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const hostWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url),
  'utf8',
);
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
  'utf8',
);
const mediaSection = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('slow watchdog execution does not recreate or reset the media host', () => {
  const timerCase = hostWindow.slice(
    hostWindow.indexOf('case WM_TIMER:'),
    hostWindow.indexOf('case WM_ERASEBKGND:'),
  );

  assert.match(timerCase, /NativeMediaWatchdogExecutionTimedOut\(hwnd, timerId\)/);
  assert.match(timerCase, /host->OnTimer\(timerId\)/);
  assert.doesNotMatch(
    timerCase,
    /PostMessageW\(hwnd,\s*kNativeMediaRecreateMessage/,
  );
});

test('phase-local watchdogs invalidate timed-out probes and retry themselves', () => {
  assert.match(
    mediaHost,
    /youtubeWatchdogInFlight_[\s\S]*youtubeWatchdogStartedTick_[\s\S]*kYoutubeWatchdogTimeoutMs[\s\S]*InvalidateYoutubeWatchdog\(\)/,
  );
  assert.match(
    mediaHost,
    /tverWatchdogInFlight_[\s\S]*tverWatchdogStartedTick_[\s\S]*kTverWatchdogTimeoutMs[\s\S]*InvalidateTverWatchdog\(\)/,
  );
});

test('real WebView process failure can still recreate the media host', () => {
  assert.match(
    mediaSection,
    /add_ProcessFailed[\s\S]*NativeMediaProcessNeedsRecreate[\s\S]*PostMessageW\(hostWindow, kNativeMediaRecreateMessage/,
  );
});
