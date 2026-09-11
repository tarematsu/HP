import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const feed = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_feed_native.inc', import.meta.url), 'utf8');
const refresh = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');

test('legacy TVer series policies are absent from runtime composition', () => {
  assert.doesNotMatch(wrapper, /media_tver_series_dom_policy\.inc/);
  assert.doesNotMatch(wrapper, /media_tver_series_policy\.inc/);
  assert.doesNotMatch(wrapper, /media_tver_native_series_resolver\.inc/);
  assert.doesNotMatch(wrapper, /NativeMediaTverSeriesWatchdogPolicyScript/);
  assert.doesNotMatch(wrapper, /PrepareNativeMediaTverSeriesResolution\(/);
  assert.doesNotMatch(wrapper, /NativeMediaTverNavigationPendingFor\(/);
});

test('unexpected TVer non-episode pages fail back to the cloud launcher', () => {
  assert.match(wrapper, /kNativeMediaTverUnexpectedPageScript/);
  assert.match(wrapper, /tver\.jp\/episodes\//);
  assert.match(wrapper, /NativeMediaWebViewSourceContains\(webview, L"tver\.jp\/"\)/);
  assert.match(wrapper, /'restart'/);
});

test('native cloud feed client is bounded and contains no series API fallback', () => {
  assert.match(wrapper, /#include "media_tver_cloud_feed_native\.inc"/);
  assert.match(wrapper, /#include "media_tver_cloud_queue_refresh\.inc"/);
  assert.match(feed, /kNativeMediaTverMaximumFeedBytes = 2U \* 1024U \* 1024U/);
  assert.match(feed, /WinHttpSetTimeouts\(session, 8000, 8000, 8000, 8000\)/);
  assert.match(feed, /NativeMediaTverFetchCloudFeed/);
  assert.match(feed, /NativeMediaTverCloudFeedEpisodeIds/);
  assert.doesNotMatch(feed, /callSeriesSeasons|callSeasonEpisodes|platform_users\/browser\/create/);
  assert.doesNotMatch(wrapper + refresh, /ResolveNativeMediaTverSeries|__homePanelTverSeriesPath/);
});

test('cloud refresh operates on the single episode queue', () => {
  assert.match(refresh, /const queueKey = '__homePanelTverEpisodeQueue'/);
  assert.doesNotMatch(refresh, /__homePanelTverEpisodeQueue:/);
  assert.match(refresh, /NativeMediaTverFetchCloudFeed\(\)/);
  assert.match(refresh, /NativeMediaTverParseCloudFeed/);
});
