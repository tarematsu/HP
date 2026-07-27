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
    /src\/sh_runtime_lifecycle_policy_fix\.h[\s\S]*src\/sh_webview_event_policy\.h[\s\S]*src\/sh_runtime_resource_policy_fix\.h/,
  );
  const lifecycleAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_lifecycle_policy_fix.h)',
  );
  const eventsAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_webview_event_policy.h)',
  );
  const resourcesAt = cmakeSource.indexOf(
    'target_precompile_headers(HomePanel PRIVATE\n  src/sh_runtime_resource_policy_fix.h)',
  );
  assert.ok(lifecycleAt >= 0 && lifecycleAt < eventsAt);
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
  assert.match(
    policySource,
    /#define add_WebMessageReceived\(handler, token\)[\s\S]*WrapStationheadWebMessageHandler/,
  );
  assert.equal(
    webviewSource.split('add_WebMessageReceived(').length - 1,
    2,
    'both playback and auth WebMessage handlers must remain behind the policy macro',
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
  assert.match(
    policySource,
    /#define add_NewWindowRequested\(handler, token\)[\s\S]*WrapStationheadNewWindowHandler/,
  );
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
    ['add_NavigationCompleted', 'WrapStationheadNavigationCompletedHandler', 2],
    ['add_ProcessFailed', 'WrapStationheadProcessFailedHandler', 2],
    ['add_WindowCloseRequested', 'WrapStationheadWindowCloseHandler', 1],
    ['add_IsDocumentPlayingAudioChanged', 'WrapStationheadAudioChangedHandler', 1],
  ]) {
    assert.match(
      policySource,
      new RegExp(`#define ${method}\\(handler, token\\)[\\s\\S]*${wrapper}`),
    );
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

test('final WebResourceRequested callback is also exception-contained', () => {
  assert.match(
    policySource,
    /WrapStationheadWebResourceRequestedHandler\([\s\S]*ICoreWebView2WebResourceRequestedEventHandler/,
  );
  assert.match(
    policySource,
    /#define add_WebResourceRequested\(handler, token\)[\s\S]*WrapStationheadWebResourceRequestedHandler/,
  );
  assert.equal(
    resourceBoundarySource.split('add_WebResourceRequested(').length - 1,
    1,
  );
  const eventsAt = cmakeSource.indexOf('src/sh_webview_event_policy.h');
  const boundaryAt = cmakeSource.indexOf('src/sh_runtime_resource_boundary_policy_fix.h');
  assert.ok(eventsAt >= 0 && eventsAt < boundaryAt);
});
