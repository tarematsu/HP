import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cloudFeed = readFileSync(
  new URL('../../cloud/src/tver_feed.js', import.meta.url),
  'utf8',
);
const unifiedWorker = readFileSync(
  new URL('../../cloud/src/unified_worker.js', import.meta.url),
  'utf8',
);
const nativeResolver = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_native_series_resolver.inc', import.meta.url),
  'utf8',
);

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

test('cloud refresh runs every hour and feed endpoint is exposed without coupling it to video admin auth', () => {
  assert.match(cloudFeed, /return date\.getUTCMinutes\(\) === 0;/);
  assert.doesNotMatch(cloudFeed, /getUTCHours\(\) % 3/);
  assert.match(unifiedWorker, /TVER_FEED_PATH = '\/v1\/native\/tver-feed'/);
  assert.match(unifiedWorker, /pathname === TVER_FEED_PATH[\s\S]*tverFeedResponse\(env, ctx\)/);
  assert.match(unifiedWorker, /shouldRefreshTverFeed\(controller\?\.scheduledTime\)/);
  assert.match(unifiedWorker, /ctx\.waitUntil\(refreshTverFeed\(env\)/);
});

test('cloud drops episodes that expire before the next hourly refresh', () => {
  assert.match(cloudFeed, /REFRESH_INTERVAL_MS = 60 \* 60 \* 1000/);
  assert.match(cloudFeed, /value\.endAt/);
  assert.match(cloudFeed, /終了予定/);
  assert.match(cloudFeed, /filterEpisodesBeforeNextRefresh/);
  assert.match(cloudFeed, /expiresAt > cutoff/);
  assert.match(cloudFeed, /episodeCount: episodes\.length/);
});

test('native resolver prefers the cloud feed but retains the current series API resolver as fallback', () => {
  const cloudIndex = nativeResolver.indexOf('kNativeMediaTverCloudFeedUrl');
  const cloudRequestIndex = nativeResolver.indexOf('NativeMediaTverCloudFeedEpisodeIds(cloudFeed)');
  const fallbackIndex = nativeResolver.indexOf('callSeriesSeasons');
  assert.ok(cloudIndex >= 0);
  assert.ok(cloudRequestIndex > cloudIndex);
  assert.ok(fallbackIndex > cloudRequestIndex);
  assert.match(nativeResolver, /https:\/\/homepanel-cloud\.tarematsu\.workers\.dev\/v1\/native\/tver-feed/);
  assert.match(nativeResolver, /if \(!resolution\.episodeIds\.empty\(\)\)[\s\S]*resolution\.success = true;[\s\S]*return resolution/);
  assert.match(nativeResolver, /catch \(\.\.\.\) \{[\s\S]*resolution\.episodeIds\.clear\(\);[\s\S]*\}[\s\S]*kApiHeaders/);
  assert.match(nativeResolver, /callSeriesSeasons/);
  assert.match(nativeResolver, /callSeasonEpisodes/);
  assert.match(nativeResolver, /sessionStorage\.setItem\('__homePanelTverEpisodeQueue:/);
});
