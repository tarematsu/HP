import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');

test('TVer runtime routes only episode pages to the active policies', () => {
  assert.match(wrapper, /#include "media_tver_episode_loop_policy\.inc"/);
  assert.match(wrapper, /#include "media_tver_playback_policy\.inc"/);
  assert.doesNotMatch(wrapper, /#include "media_tver_series_dom_policy\.inc"/);
  assert.doesNotMatch(wrapper, /#include "media_tver_series_policy\.inc"/);
  assert.doesNotMatch(wrapper, /#include "media_tver_native_series_resolver\.inc"/);
  assert.doesNotMatch(wrapper, /PrepareNativeMediaTverSeriesResolution\(/);
  assert.doesNotMatch(wrapper, /NativeMediaTverNavigationPendingFor\(/);
  assert.match(wrapper, /tver\.jp\/episodes\//);
  assert.doesNotMatch(wrapper, /kNativeMediaTverEpisodeLoopPolicyScript/);
  assert.match(wrapper, /kNativeMediaTverPlaybackWatchdogPolicyScript/);
  assert.match(wrapper, /kNativeMediaTverUnexpectedPageScript/);
});

test('unexpected TVer pages restart instead of reactivating series DOM fallback', () => {
  assert.match(wrapper, /kNativeMediaTverUnexpectedPageScript/);
  assert.match(wrapper, /\(\(\) => 'restart'\)\(\)/);
  assert.match(
    wrapper,
    /NativeMediaWebViewSourceContains\(webview, L"tver\.jp\/"\)[\s\S]*kNativeMediaTverUnexpectedPageScript/,
  );
});

test('event wake bridge accepts only fixed messages and revalidates current source', () => {
  assert.match(wrapper, /add_WebMessageReceived/);
  assert.match(wrapper, /put_IsWebMessageEnabled\(TRUE\)/);
  assert.match(wrapper, /homepanel:youtube-wake/);
  assert.match(wrapper, /homepanel:tver-wake/);
  assert.match(wrapper, /youtube\.com\/watch/);
  assert.match(wrapper, /list=PLMWqSdpIVl30/);
  assert.match(wrapper, /tver\.jp\/episodes\//);
  assert.match(wrapper, /PostMessageW\(hostWindow, WM_TIMER/);
});

test('TVer cloud refresh uses the dedicated native cloud-feed client directly', () => {
  assert.match(wrapper, /#include "media_tver_cloud_feed_native\.inc"/);
  assert.match(wrapper, /#include "media_tver_cloud_queue_refresh\.inc"/);
  assert.match(wrapper, /NativeMediaTverPrepareCloudQueueRefresh\(hostWindow, alive, false\)/);
  assert.doesNotMatch(wrapper, /PrepareNativeMediaTverCloudQueueRefresh/);
  assert.doesNotMatch(wrapper, /NativeMediaTverSeriesWatchdogPolicyScript/);
});

test('YouTube routing keeps only the watchdog bridge special case', () => {
  assert.doesNotMatch(wrapper, /script == kNativeMediaPlayAllScript/);
  assert.match(wrapper, /script == kNativeMediaYoutubeWatchdogScript/);
  assert.match(wrapper, /NativeMediaEnsureEventWakeBridge\(webview, hostWindow, alive\)/);
  assert.doesNotMatch(wrapper, /YoutubeTrustedAction|YoutubeEventAgent/);
});
