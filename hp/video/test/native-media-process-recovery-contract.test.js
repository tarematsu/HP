import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const base = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url),
  'utf8',
);
const section = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const hostWindow = readFileSync(
  new URL('../../native/src/renderer_panels/media_host_window.inc', import.meta.url),
  'utf8',
);

test('media WebView recreates only for browser and renderer process failures', () => {
  assert.match(section, /add_ProcessFailed\(/);
  assert.match(section, /bool NativeMediaProcessNeedsRecreate\(/);
  for (const kind of [
    'COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED',
    'COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED',
    'COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE',
  ]) {
    assert.match(section, new RegExp(kind));
  }
  assert.match(
    section,
    /return kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED[\s\S]*COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED[\s\S]*COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE/,
  );
  assert.match(section, /PostMessageW\(hostWindow, kNativeMediaRecreateMessage, 0, 0\)/);
  assert.match(base, /kNativeMediaRecreateMessage = WM_USER \+ 0x4D/);
});

test('a watchdog ExecuteScript that stays unresolved for five seconds recreates the host', () => {
  assert.match(base, /kNativeMediaWatchdogExecutionTimeoutMs = 5ULL \* 1000ULL/);
  assert.match(section, /NativeMediaBeginWatchdogExecution/);
  assert.match(section, /NativeMediaWatchdogExecutionTimedOut/);
  assert.match(section, /FAILED\(result\)[\s\S]*kNativeMediaRecreateMessage/);
  assert.match(hostWindow, /NativeMediaWatchdogExecutionTimedOut\(hwnd, timerId\)/);
  assert.match(hostWindow, /PostMessageW\(hwnd, kNativeMediaRecreateMessage, 0, 0\)/);
  assert.match(hostWindow, /DestroyWindow\(hwnd\)[\s\S]*EnsureNativeMvPanel\(/);
});

test('media host recreation drops stale watchdog state with the old HWND', () => {
  assert.match(hostWindow, /case WM_NCDESTROY:[\s\S]*NativeMediaForgetWatchdogExecution\(hwnd\)/);
  assert.match(section, /state\.hostWindow = nullptr/);
  assert.match(section, /state\.inFlight = false/);
});

test('video resize preserves sibling Z-order after status-strip removal', () => {
  assert.doesNotMatch(hostWindow, /SetWindowPos\(status/);
  assert.doesNotMatch(hostWindow, /HomePanelNativeSpotifyStatus/);
  assert.match(hostWindow, /SetWindowPos\([\s\S]*host, nullptr[\s\S]*SWP_NOZORDER/);
});
