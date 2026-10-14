import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmakeSource = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const policySource = readFileSync(
  new URL('../../native/src/sh_webview_event_policy.h', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);
const resourceBoundarySource = readFileSync(
  new URL('../../native/src/sh_runtime_resource_boundary_policy_fix.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('WebView event policy is compiled without disturbing resource policy order', () => {
  assert.match(
    cmakeSource,
    /src\/sh_auth_capture_origin_policy\.h[\s\S]*src\/sh_webview_event_policy\.h[\s\S]*src\/sh_runtime_resource_policy_fix\.h/,
  );
  const pch = section(
    cmakeSource,
    'target_precompile_headers(HomePanel PRIVATE',
    'add_dependencies(HomePanel',
  );
  const authCaptureAt = pch.indexOf('src/sh_auth_capture_origin_policy.h');
  const eventsAt = pch.indexOf('src/sh_webview_event_policy.h');
  const resourcesAt = pch.indexOf('src/sh_runtime_resource_policy_fix.h');
  assert.ok(authCaptureAt >= 0 && authCaptureAt < eventsAt);
  assert.ok(eventsAt >= 0 && eventsAt < resourcesAt);
});

test('native WebMessage dispatch requires a matching trusted current origin', () => {
  const wrapper = section(
    policySource,
    'WrapStationheadWebMessageHandler(',
    'inline ComPtr<ICoreWebView2NewWindowRequestedEventHandler>',
  );
  assert.match(wrapper, /args->get_Source\(&messageSource\)/);
  assert.match(wrapper, /sender->get_Source\(&currentSource\)/);
  assert.match(wrapper, /SameTrustedMessageOrigin\(messageSource, currentSource\)/);
  assert.match(wrapper, /if \(!trusted\) return S_OK;/);
  assert.ok(
    wrapper.indexOf('if (!trusted) return S_OK;') <
      wrapper.indexOf('InvokeEventNoexcept(inner, sender, args)'),
  );
  assert.doesNotMatch(policySource, /#define add_WebMessageReceived\(/);
  assert.equal((webviewSource.match(/WrapStationheadWebMessageHandler\(/g) || []).length, 2);
  assert.equal(
    webviewSource.split('add_WebMessageReceived(').length - 1,
    2,
    'both playback and auth WebMessage handlers use the same trust wrapper',
  );
});

test('trusted hosts use exact or dot-delimited suffixes and HTTPS port 443', () => {
  assert.match(policySource, /host\[host\.size\(\) - domain\.size\(\) - 1\] != L'\.'/);
  assert.match(policySource, /HostMatchesDomain\(host, L"stationhead\.com"\)/);
  assert.match(policySource, /HostMatchesDomain\(host, L"spotify\.com"\)/);
  assert.match(policySource, /components\.nScheme != INTERNET_SCHEME_HTTPS/);
  assert.match(policySource, /origin\.port == INTERNET_DEFAULT_HTTPS_PORT/);
  assert.match(policySource, /!IsStationheadHost\(L"stationhead\.com\.example\.net"\)/);
  assert.match(policySource, /!IsSpotifyHost\(L"spotify\.com\.example\.net"\)/);
});

test('unrelated and unhandled trusted popups are contained before browser escape', () => {
  const wrapper = section(
    policySource,
    'WrapStationheadNewWindowHandler(',
    'inline ComPtr<ICoreWebView2NavigationStartingEventHandler>',
  );
  assert.match(wrapper, /sender->get_Source\(&currentSource\)/);
  assert.match(wrapper, /args->get_Uri\(&targetUri\)/);
  assert.match(wrapper, /IsTrustedPlaybackUri\(currentSource\)/);
  assert.match(wrapper, /IsTrustedPopupTarget\(targetUri\)/);
  assert.match(wrapper, /if \(!trusted\) \{[\s\S]*args->put_Handled\(TRUE\);[\s\S]*return S_OK;/);
  assert.ok(
    wrapper.indexOf('if (!trusted) {') <
      wrapper.indexOf('InvokeEventNoexcept(inner, sender, args)'),
  );
  assert.match(wrapper, /args->get_Handled\(&handled\)/);
  assert.match(
    wrapper,
    /FAILED\(result\) \|\| FAILED\(handledResult\) \|\| handled == FALSE/,
  );
  assert.match(
    wrapper,
    /handled == FALSE[\s\S]*args->put_Handled\(TRUE\);/,
  );
  assert.doesNotMatch(policySource, /#define add_NewWindowRequested\(/);
  assert.match(webviewSource, /WrapStationheadNewWindowHandler\(/);
  assert.equal(webviewSource.split('add_NewWindowRequested(').length - 1, 1);
});

test('every Stationhead WebView callback is contained at the COM boundary', () => {
  const invoker = section(
    policySource,
    'inline HRESULT InvokeEventNoexcept(',
    'inline ComPtr<ICoreWebView2WebMessageReceivedEventHandler>',
  );
  assert.match(invoker, /try \{[\s\S]*handler->Invoke\(sender, args\);/);
  assert.match(invoker, /catch \(\.\.\.\)[\s\S]*return E_FAIL;/);

  for (const [method, wrapper, expectedCount] of [
    ['add_NavigationStarting', 'WrapStationheadNavigationStartingHandler', 1],
    ['add_NavigationCompleted', 'WrapStationheadAuthStableNavigationCompletedHandler', 2],
    ['add_ProcessFailed', 'WrapStationheadAuthStableProcessFailedHandler', 2],
    ['add_WindowCloseRequested', 'WrapStationheadWindowCloseHandler', 1],
    ['add_IsDocumentPlayingAudioChanged', 'WrapStationheadAudioChangedHandler', 1],
  ]) {
    assert.doesNotMatch(policySource, new RegExp(`#define ${method}\\(`));
    const observedWrappers = (webviewSource.match(new RegExp(`${wrapper}\\(`, 'g')) || []).length;
    assert.equal(observedWrappers, expectedCount, `${wrapper} must wrap every registration`);
    assert.equal(
      webviewSource.split(`${method}(`).length - 1,
      expectedCount,
      `${method} call count changed without updating its policy coverage`,
    );
  }

  const navigationStart = section(
    policySource,
    'WrapStationheadNavigationStartingHandler(',
    'inline ComPtr<ICoreWebView2NavigationCompletedEventHandler>',
  );
  assert.match(
    navigationStart,
    /if \(FAILED\(result\) && args\) args->put_Cancel\(TRUE\);/,
  );
});

test('the one active WebResourceRequested callback is wrapped explicitly, without a PCH macro', () => {
  const active = readFileSync(
    new URL('../../native/src/sh_runtime_script_resource_policy_fix.h', import.meta.url), 'utf8');
  const callback = section(active,
    'inline void ApplyStationheadResourceBlockingScriptFixed(', '}  // namespace hp');
  assert.match(policySource,
    /WrapStationheadWebResourceRequestedHandler\([\s\S]*InvokeEventNoexcept\(inner, sender, args\)/);
  assert.doesNotMatch(policySource, /#define add_WebResourceRequested\(/);
  assert.equal((callback.match(/add_WebResourceRequested\(/g) || []).length, 1);
  assert.match(callback,
    /stationhead_webview_policy::WrapStationheadWebResourceRequestedHandler\(/);
  assert.match(callback,
    /Callback<ICoreWebView2WebResourceRequestedEventHandler>\(/);
  assert.match(callback, /\}\)\.Get\(\)\)\.Get\(\),\s*&token\)/);
  assert.doesNotMatch(resourceBoundarySource, /add_WebResourceRequested\(/);
});