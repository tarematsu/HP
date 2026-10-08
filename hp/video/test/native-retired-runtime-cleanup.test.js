import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const root = name => new URL(`../../native/src/${name}`, import.meta.url);

test('Stationhead has one persistent configured room without time-of-day routing', () => {
  const config = source('config.h');
  const app = source('app.cpp');
  const player = source('sh.cpp');
  const header = source('sh.h');
  assert.match(config, /https:\/\/www\.stationhead\.com\/sakuramankai/);
  for (const code of [app, player, header]) {
    assert.doesNotMatch(code, /SetRouteDelayMinutes|StationheadScheduledUrl|StationheadNextRouteChangeAt|JST scheduled room change/);
  }
  assert.doesNotMatch(player, /stationhead\.com\/c\/(unity|ohisama)/);
  assert.equal(existsSync(root('stationhead_daily_route.h')), false);
});

test('native monitor DOM authentication probes target selected or potentially unauthenticated profiles', () => {
  const code = source('sh_audio_loss.cpp');
  assert.match(code, /const bool needsDomProbe = selectedMonitor \|\|/);
  assert.match(code, /!AudioPlaying\(\)/);
  assert.match(code, /if \(needsDomProbe\)/);
  assert.match(code, /clearMonitorAuth = true/);
});

test('retired Spotify runtime is not linked or retained', () => {
  assert.equal(existsSync(root('spotify_webviews.h')), false);
  assert.equal(existsSync(root('spotify_webviews.cpp')), false);
  assert.equal(existsSync(root('spotify_webviews.inc')), false);
  const lifecycle = source('renderer_lifecycle.cpp');
  assert.doesNotMatch(lifecycle, /SpotifyWebViews|StartSpotify|GetSpotifyPlaybackStatuses/);
});

test('retired native statistics and dashboard-polling transport cannot run', () => {
  const sh = source('sh.cpp');
  const webview = source('sh_webview.cpp');
  const cache = source('webview_startup_cache_reset.h');
  const cloud = source('cloud_client_sync.cpp');
  const app = source('app.cpp');
  assert.doesNotMatch(sh, /PollDailyPlayStats|kStationheadDailyPlayStatsIntervalMs/);
  assert.doesNotMatch(webview, /stationhead-play-stats|statsAuthGeneration_/);
  assert.doesNotMatch(cache, /StationheadApiPlayStatsScript/);
  assert.doesNotMatch(cloud, /stationheadHealthPath|StationheadHealthSummary/);
  assert.doesNotMatch(app, /NativePlaybackNextWakeAt/);
  for (const name of [
    'dashboard_native_playback.cpp', 'dashboard_playback_resolve.cpp',
    'dashboard_native_minute_facts.cpp', 'cloud_client_stationhead_health.cpp'
  ]) assert.equal(existsSync(root(name)), false);
});
