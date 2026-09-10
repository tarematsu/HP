import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);

test('TVer watchdog routing selects page-specific policies by WebView source', () => {
  assert.match(wrapper, /#include \"media_tver_native_series_resolver\.inc\"/);
  assert.match(wrapper, /#include \"media_tver_episode_loop_policy\.inc\"/);
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
  assert.match(wrapper, /return kNativeMediaTverEpisodeLoopPolicyScript/);
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

test('TVer source reads are confined to TVer loop/watchdog routing before YouTube branches', () => {
  const loopBranch = wrapper.indexOf('script == kNativeMediaTverLoopScript');
  const watchdogBranch = wrapper.indexOf('script == kNativeMediaTverWatchdogScript');
  const youtubeBranch = wrapper.indexOf('script == kNativeMediaPlayAllScript');
  const sourceLookups = [...wrapper.matchAll(/NativeMediaWebViewSourceContains\(webview/g)]
    .map(match => match.index);
  assert.ok(loopBranch >= 0);
  assert.ok(watchdogBranch > loopBranch);
  assert.ok(youtubeBranch > watchdogBranch);
  assert.ok(sourceLookups.length >= 3);
  assert.ok(sourceLookups.every(index => index > loopBranch && index < youtubeBranch));
});

test('TVer episode loop routing changes only TVer episode pages and preserves YouTube routing', () => {
  assert.match(
    wrapper,
    /script == kNativeMediaTverLoopScript &&[\s\S]*tver\.jp\/episodes\/[\s\S]*return kNativeMediaTverEpisodeLoopPolicyScript/,
  );
  assert.match(wrapper, /script == kNativeMediaPlayAllScript/);
  assert.match(wrapper, /return kNativeMediaYoutubeReliablePlayAllScript/);
  assert.match(wrapper, /script == kNativeMediaYoutubeWatchdogScript/);
  assert.match(wrapper, /NativeMediaEnsureYoutubeTrustedAction\(webview\)/);
  assert.match(wrapper, /return kNativeMediaYoutubeControlRecoveryScript/);
  assert.doesNotMatch(wrapper, /kNativeMediaYoutubeHealthScript|kNativeMediaYoutubeHealthPolicyScript/);
});
