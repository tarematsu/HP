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
    /src\/sh_runtime_lifecycle_policy\.h[\s\S]*src\/sh_webview_event_policy\.h[\s\S]*src\/sh_runtime_resource_policy_fix\.h/,
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
      wrapper.indexOf('inner->Invoke(sender, args)'),
  );
  assert.match(wrapper, /catch \(\.\.\.\)[\s\S]*return E_FAIL;/);
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

test('unrelated popups are suppressed before auth controller creation', () => {
  const wrapper = section(
    policySource,
    'WrapStationheadNewWindowHandler(',
    '}  // namespace stationhead_webview_policy',
  );
  assert.match(wrapper, /sender->get_Source\(&currentSource\)/);
  assert.match(wrapper, /args->get_Uri\(&targetUri\)/);
  assert.match(wrapper, /IsTrustedPlaybackUri\(currentSource\)/);
  assert.match(wrapper, /IsTrustedPopupTarget\(targetUri\)/);
  assert.match(wrapper, /if \(!trusted\) \{[\s\S]*args->put_Handled\(TRUE\);[\s\S]*return S_OK;/);
  assert.ok(
    wrapper.indexOf('if (!trusted) {') < wrapper.indexOf('inner->Invoke(sender, args)'),
  );
  assert.match(
    policySource,
    /#define add_NewWindowRequested\(handler, token\)[\s\S]*WrapStationheadNewWindowHandler/,
  );
  assert.equal(webviewSource.split('add_NewWindowRequested(').length - 1, 1);
});
