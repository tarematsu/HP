import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const eventPolicy = readFileSync(
  new URL('../../native/src/sh_webview_event_policy.h', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('trusted popup failures cannot escape the native Stationhead surface', () => {
  const wrapper = section(
    eventPolicy,
    'WrapStationheadNewWindowHandler(',
    'inline ComPtr<ICoreWebView2NavigationStartingEventHandler>',
  );
  const invokeAt = wrapper.indexOf('InvokeEventNoexcept(inner, sender, args)');
  const handledReadAt = wrapper.indexOf('args->get_Handled(&handled)');
  const containmentAt = wrapper.indexOf(
    'FAILED(result) || FAILED(handledResult) || handled == FALSE',
  );
  const forceHandledAt = wrapper.lastIndexOf('args->put_Handled(TRUE);');
  assert.ok(
    invokeAt >= 0 &&
      handledReadAt > invokeAt &&
      containmentAt > handledReadAt &&
      forceHandledAt > containmentAt,
  );
});

test('untrusted popup targets remain blocked before the inner handler', () => {
  const wrapper = section(
    eventPolicy,
    'WrapStationheadNewWindowHandler(',
    'inline ComPtr<ICoreWebView2NavigationStartingEventHandler>',
  );
  const trustAt = wrapper.indexOf('if (!trusted)');
  const blockedAt = wrapper.indexOf('args->put_Handled(TRUE);', trustAt);
  const invokeAt = wrapper.indexOf('InvokeEventNoexcept(inner, sender, args)');
  assert.ok(trustAt >= 0 && blockedAt > trustAt && invokeAt > blockedAt);
});

test('native auth-host failures still report unhandled to the containment wrapper', () => {
  const popupHandler = section(
    webviewSource,
    'const HRESULT newWindowResult = webview_->add_NewWindowRequested(',
    'if (FAILED(newWindowResult))',
  );
  assert.match(
    popupHandler,
    /if \(!environment_ \|\| !EnsureAuthHostWindow\(\)\)[\s\S]*args->put_Handled\(FALSE\);/,
  );
  assert.match(
    eventPolicy,
    /handled == FALSE[\s\S]*args->put_Handled\(TRUE\);/,
  );
});
