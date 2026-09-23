import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
  'utf8',
);
const panels = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);
const policy = readFileSync(
  new URL('../../native/src/webview_feature_policy.h', import.meta.url),
  'utf8',
);

test('media panel hides the built-in WebView error page while retrying', () => {
  assert.match(host, /controller_\.Get\(\), webview_\.Get\(\), false/);
  assert.match(policy, /settings->put_IsBuiltInErrorPageEnabled\(FALSE\)/);
  assert.match(host, /if \(FAILED\(args->get_IsSuccess\(&succeeded\)\) \|\| !succeeded\)/);
  assert.match(
    host,
    /StopYoutubeMonitors\(\);[\s\S]*StopTverPlaybackMonitor\(\);[\s\S]*ScheduleNavigationRetry\(\);/,
  );
});

test('internet disconnect shows a large centered native overlay on the video panel', () => {
  assert.match(
    panels,
    /COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED/,
  );
  assert.match(panels, /インターネット接続がありません/);
  assert.match(panels, /DT_CENTER \| DT_SINGLELINE \| DT_VCENTER/);
  assert.match(panels, /FW_BOLD/);
  assert.match(panels, /SetWindowPos\([\s\S]*HWND_TOP/);
  assert.match(
    panels,
    /WrapNativeMediaNavigationCompletedHandler\(\(handler\), hostWindow_\)/,
  );
});

test('successful media navigation hides the offline overlay automatically', () => {
  const wrapperStart = panels.indexOf('WrapNativeMediaNavigationCompletedHandler(');
  assert.notEqual(wrapperStart, -1);
  const wrapper = panels.slice(wrapperStart);
  assert.match(wrapper, /if \(succeeded\) \{[\s\S]*SetNativeMediaOfflineOverlay\(hostWindow, false\)/);
  assert.match(wrapper, /SetNativeMediaOfflineOverlay\(hostWindow, true\)/);
});
