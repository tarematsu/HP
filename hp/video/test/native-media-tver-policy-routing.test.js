import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('TVer watchdog routing selects page-specific policies by WebView source', () => {
  assert.match(wrapper, /#include \"media_tver_native_series_resolver\.inc\"/);
  assert.match(wrapper, /#include \"media_tver_series_dom_policy\.inc\"/);
  assert.match(wrapper, /#include \"media_tver_series_policy\.inc\"/);
  assert.match(wrapper, /#include \"media_tver_playback_policy\.inc\"/);
  assert.doesNotMatch(wrapper, /#include \"media_tver_series_api_policy\.inc\"/);
  assert.doesNotMatch(wrapper, /#include \"media_tver_start_policy\.inc\"/);
  assert.match(wrapper, /ResolveNativeMediaPolicyScript\([\s\S]*ICoreWebView2\* webview/);
  assert.match(wrapper, /tver\.jp\/series\//);
  assert.match(wrapper, /PrepareNativeMediaTverSeriesResolution\(webview, hostWindow, alive\)/);
  assert.match(wrapper, /NativeMediaTverNavigationPendingFor\(webview\)/);
  assert.match(wrapper, /return kNativeMediaTverNavigationPendingScript/);
  assert.match(wrapper, /return NativeMediaTverSeriesWatchdogPolicyScript\(\)/);
  assert.match(wrapper, /tver\.jp\/episodes\//);
  assert.match(wrapper, /return kNativeMediaTverPlaybackWatchdogPolicyScript/);
  assert.match(wrapper, /return kNativeMediaTverWatchdogStaticScript/);
});

test('native TVer navigation suppresses the same-cycle DOM fallback', () => {
  const prepareIndex = wrapper.indexOf('PrepareNativeMediaTverSeriesResolution(webview, hostWindow, alive)');
  const pendingIndex = wrapper.indexOf('NativeMediaTverNavigationPendingFor(webview)');
  const domIndex = wrapper.indexOf('return NativeMediaTverSeriesWatchdogPolicyScript()');
  assert.ok(prepareIndex >= 0);
  assert.ok(pendingIndex > prepareIndex);
  assert.ok(domIndex > pendingIndex);
  assert.match(wrapper, /kNativeMediaTverNavigationPendingScript\[\] = L"null"/);
});

test('TVer native resolution receives host lifetime without moving API work into the base host', () => {
  assert.match(
    wrapper,
    /ResolveNativeMediaPolicyScript\(\s*\(script\), webview_\.Get\(\), hostWindow_, alive_\)/,
  );
  assert.match(wrapper, /const std::shared_ptr<std::atomic<bool>>& alive/);
});

test('TVer page routing reads source only for the TVer watchdog branch', () => {
  const tverBranch = wrapper.indexOf('script == kNativeMediaTverWatchdogScript');
  const sourceLookup = wrapper.indexOf('NativeMediaWebViewSourceContains(webview');
  const youtubeBranch = wrapper.indexOf('script == kNativeMediaPlayAllScript');
  assert.ok(tverBranch >= 0);
  assert.ok(sourceLookup > tverBranch);
  assert.ok(youtubeBranch > sourceLookup);
});

test('TVer policy routing does not alter the legacy loop or YouTube routing', () => {
  assert.match(wrapper, /script == kNativeMediaPlayAllScript/);
  assert.match(wrapper, /return kNativeMediaYoutubeReliablePlayAllScript/);
  assert.match(wrapper, /script == kNativeMediaYoutubeWatchdogScript/);
  assert.match(wrapper, /return kNativeMediaYoutubeWatchdogPolicyScript/);
  assert.match(wrapper, /script == kNativeMediaYoutubeHealthScript/);
  assert.match(wrapper, /return kNativeMediaYoutubeHealthPolicyScript/);
});
