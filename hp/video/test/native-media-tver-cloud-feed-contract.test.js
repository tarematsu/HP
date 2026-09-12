import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const cloudFeed = readFileSync(
  new URL('../../cloud/src/tver_feed.js', import.meta.url),
  'utf8',
);
const unifiedWorker = readFileSync(
  new URL('../../cloud/src/unified_worker.js', import.meta.url),
  'utf8',
);
const nativeFeed = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_feed_native.inc', import.meta.url),
  'utf8',
);
const cloudQueueRefresh = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url),
  'utf8',
);
const mediaSection = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const mediaPanel = readFileSync(
  new URL('../../native/src/renderer_panels/media_section_base.inc', import.meta.url),
  'utf8',
);
const mediaHost = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
  'utf8',
);
const playbackPolicy = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_playback_policy.inc', import.meta.url);

test('cloud collects Sakurazaka TVer episodes from dedicated sources and preserves last good feed', () => {
  assert.match(cloudFeed, /TVER_ORIGIN = 'https:\/\/tver\.jp'/);
  assert.match(cloudFeed, /TVER_TALENT_ID = 't04c4bf'/);
  assert.match(cloudFeed, /TVER_TALENT_URL = `\$\{TVER_ORIGIN\}\/talents\/\$\{TVER_TALENT_ID\}`/);
  assert.match(cloudFeed, /sakamichidb\.anosaka\.com\/tver_programs/);
  assert.match(cloudFeed, /Promise\.allSettled/);
  assert.match(cloudFeed, /if \(!episodes\.length\)[\s\S]*throw new Error/);
  assert.match(cloudFeed, /DATA_BUCKET\.put\(FEED_OBJECT_KEY/);
  assert.match(cloudFeed, /MAX_FEED_AGE_MS = 12 \* 60 \* 60 \* 1000/);
  assert.match(cloudFeed, /ageMs > MAX_FEED_AGE_MS/);
});

test('cloud refresh runs every hour and feed endpoint is exposed without video admin auth', () => {
  assert.match(cloudFeed, /return date\.getUTCMinutes\(\) === 0;/);
  assert.doesNotMatch(cloudFeed, /getUTCHours\(\) % 3/);
  assert.match(unifiedWorker, /TVER_FEED_PATH = '\/v1\/native\/tver-feed'/);
  assert.match(unifiedWorker, /pathname === TVER_FEED_PATH[\s\S]*tverFeedResponse\(env, ctx\)/);
  assert.match(unifiedWorker, /shouldRefreshTverFeed\(controller\?\.scheduledTime\)/);
  assert.match(unifiedWorker, /ctx\.waitUntil\(dispatchTverFeedRefresh\(env\)/);
  assert.doesNotMatch(unifiedWorker, /ctx\.waitUntil\(refreshTverFeed\(env\)/);
});

test('cloud drops episodes that expire before the next hourly refresh', () => {
  assert.match(cloudFeed, /REFRESH_INTERVAL_MS = 60 \* 60 \* 1000/);
  assert.match(cloudFeed, /value\.endAt/);
  assert.match(cloudFeed, /終了予定/);
  assert.match(cloudFeed, /filterEpisodesBeforeNextRefresh/);
  assert.match(cloudFeed, /expiresAt > cutoff/);
  assert.match(cloudFeed, /episodeCount: episodes\.length/);
});

test('native playback uses the cloud feed as its only discovery source', () => {
  assert.match(nativeFeed, /kNativeMediaTverCloudFeedUrl/);
  assert.match(nativeFeed, /homepanel-cloud\.tarematsu\.workers\.dev\/v1\/native\/tver-feed/);
  assert.match(nativeFeed, /NativeMediaTverFetchCloudFeed/);
  assert.match(nativeFeed, /NativeMediaTverCloudFeedEpisodeIds/);
  assert.doesNotMatch(nativeFeed, /callSeriesSeasons|callSeasonEpisodes|platform_users\/browser\/create/);
  assert.match(mediaSection, /#include "media_tver_cloud_feed_native\.inc"/);
  assert.doesNotMatch(mediaSection, /media_tver_native_series_resolver\.inc/);
});

test('native TVer phase selects and navigates an episode without a data-page bootstrap', () => {
  assert.doesNotMatch(mediaPanel, /kNativeMediaTverUrl|data:text\/html|homepanel_launch/);
  assert.match(mediaHost, /NativeMediaTverBeginQueuePhase\(hostWindow_, alive_\)/);
  assert.match(mediaHost, /NativeMediaTverCurrentEpisodeUrl\(hostWindow_, alive_\)/);
  assert.match(mediaHost, /webview_->Navigate\(url\.c_str\(\)\)/);
  assert.match(mediaHost, /NativeMediaTverMarkNavigationStarted\(url\)/);
  assert.doesNotMatch(playbackPolicy, /launcherParam|episodeQueueKey|sessionStorage/);
  assert.doesNotMatch(playbackPolicy, /location\.replace\(/);
});

test('native TVer refresh preserves current selection and consumed state without page injection', () => {
  assert.match(cloudQueueRefresh, /kNativeMediaTverCloudQueueRefreshMs =\s*30ULL \* 60ULL \* 1000ULL/);
  assert.match(cloudQueueRefresh, /kNativeMediaTverStartupTimeoutMs = 30ULL \* 1000ULL/);
  assert.match(cloudQueueRefresh, /NativeMediaTverFetchCloudFeed\(\)/);
  assert.match(cloudQueueRefresh, /NativeMediaTverParseCloudFeed/);
  assert.match(cloudQueueRefresh, /GetNamedString\(L"generatedAt"/);
  assert.match(cloudQueueRefresh, /struct NativeMediaTverNativeQueueState/);
  assert.match(cloudQueueRefresh, /latestEpisodeIds/);
  assert.match(cloudQueueRefresh, /queueEpisodeIds/);
  assert.match(cloudQueueRefresh, /consumedEpisodeIds/);
  assert.match(cloudQueueRefresh, /Never interrupt an episode that is already selected/);
  assert.match(cloudQueueRefresh, /Queue exhaustion starts a fresh cycle/);
  assert.doesNotMatch(
    cloudQueueRefresh,
    /ExecuteScript\s*\(|sessionStorage\s*\.|location\.replace\s*\(|\bfetch\s*\(/,
  );
  assert.match(
    mediaSection,
    /tver\.jp\/episodes\/[\s\S]*PrepareNativeMediaTverCloudQueueRefresh\(webview, hostWindow, alive\)[\s\S]*kNativeMediaTverPlaybackWatchdogPolicyScript/,
  );
});
