import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url), 'utf8');
const resolver = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_native_series_resolver.inc', import.meta.url), 'utf8');
const refresh = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');

test('legacy TVer series DOM policies are no longer part of runtime composition', () => {
  assert.doesNotMatch(wrapper, /media_tver_series_dom_policy\.inc/);
  assert.doesNotMatch(wrapper, /media_tver_series_policy\.inc/);
  assert.doesNotMatch(wrapper, /NativeMediaTverSeriesWatchdogPolicyScript/);
  assert.doesNotMatch(wrapper, /PrepareNativeMediaTverSeriesResolution\(/);
  assert.doesNotMatch(wrapper, /NativeMediaTverNavigationPendingFor\(/);
});

test('unexpected TVer series pages fail back to the cloud launcher', () => {
  assert.match(wrapper, /kNativeMediaTverUnexpectedPageScript/);
  assert.match(wrapper, /tver\.jp\/episodes\//);
  assert.match(wrapper, /tver\.jp\//);
  assert.match(wrapper, /'restart'/);
});

test('native cloud refresh reuses bounded HTTP helpers without routing series discovery', () => {
  assert.match(wrapper, /#include "media_tver_native_series_resolver\.inc"/);
  assert.match(wrapper, /#include "media_tver_cloud_queue_refresh\.inc"/);
  assert.match(refresh, /NativeMediaTverHttpRequest/);
  assert.match(refresh, /kNativeMediaTverCloudFeedUrl/);
  assert.match(resolver, /kNativeMediaTverMaximumApiBytes = 2U \* 1024U \* 1024U/);
  assert.match(resolver, /WinHttpSetTimeouts\(session, 8000, 8000, 8000, 8000\)/);
});

test('series resolver implementation remains unreachable from active TVer routing', () => {
  assert.match(resolver, /ResolveNativeMediaTverSeries/);
  assert.doesNotMatch(wrapper, /ResolveNativeMediaTverSeries\(/);
  assert.doesNotMatch(wrapper, /callSeriesSeasons|callSeasonEpisodes/);
});
