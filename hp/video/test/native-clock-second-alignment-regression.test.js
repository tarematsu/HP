import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const windows = readFileSync(
  new URL('../../native/src/renderer_panels/windows.inc', import.meta.url),
  'utf8',
);
const layout = readFileSync(
  new URL('../../native/src/renderer_panels/layout_overrides.inc', import.meta.url),
  'utf8',
);
const panelState = readFileSync(
  new URL('../../native/src/renderer_panel_state.cpp', import.meta.url),
  'utf8',
);
const http = readFileSync(
  new URL('../../native/src/cloud_client_http.cpp', import.meta.url),
  'utf8',
);
const helpers = readFileSync(
  new URL('../../native/src/winhttp_helpers.h', import.meta.url),
  'utf8',
);

test('native dashboard clock uses network time instead of Windows wall clock', () => {
  assert.match(
    windows,
    /UINT NativePanelTickDelayToNextSecond\(\) noexcept[\s\S]*NetworkClockDelayToNextSecond\(\)/,
  );
  assert.doesNotMatch(windows, /GetLocalTime/);
  assert.match(
    windows,
    /SetTimer\(nativeMainWindow_, kNativePanelTickTimer,\s*NativePanelTickDelayToNextSecond\(\), nullptr\)/,
  );
  assert.match(
    windows,
    /TickNativePanels\(UnixMillis\(\), true\);[\s\S]*SetTimer\(hwnd, kNativePanelTickTimer,\s*NativePanelTickDelayToNextSecond\(\), nullptr\)/,
  );

  assert.match(layout, /NetworkClockJstNow\(&hpNow\)/);
  assert.doesNotMatch(layout, /GetLocalTime/);
  assert.match(panelState, /NetworkClockJstNow\(&localTime\)/);
  assert.doesNotMatch(panelState, /GetLocalTime/);

  assert.match(http, /SynchronizeNetworkClockFromHttpResponse\(request\)/);
  assert.match(helpers, /WINHTTP_QUERY_DATE\s*\|\s*WINHTTP_QUERY_FLAG_SYSTEMTIME/);
  assert.match(helpers, /GetTickCount64\(\)/);
  assert.doesNotMatch(helpers, /system_clock::now/);
});
