import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

const collectorHeader = read('../../native/src/spotify_artist_chart_collector.h');
const collector = read('../../native/src/spotify_artist_chart_collector.inl');
const spool = read('../../native/src/spotify_artist_chart_capture_spool.h');
const leaderboardHeader = read('../../native/src/stationhead_leaderboard_collector.h');
const appMessages = read('../../native/src/app_messages.cpp');
const exchange = read('../../native/src/cloud_client_exchange.inc');
const cloudCapture = read('../../cloud/src/spotify_artist_chart_capture.ts');
const chartIngest = read('../../cloud/src/spotify_artist_chart_ingest.ts');
const cloudConfig = read('../../cloud/wrangler.jsonc');
const deviceExchange = read('../../cloud/src/device_exchange_payload.ts');

test('Spotify Japan daily artist chart uses the authenticated Stationhead WebView2 profile without exporting credentials', () => {
  assert.match(collectorHeader, /profileName_\{L"spotify-v2-6"\}/);
  assert.match(collector, /charts\.spotify\.com\/charts\/view\/artist-jp-daily\/latest/);
  assert.match(collector, /charts-spotify-com-service\.spotify\.com\/auth\/v0\/charts\/artist-jp-daily\//);
  assert.match(collector, /add_WebResourceResponseReceived/);
  assert.match(collector, /GetContent/);
  assert.match(collector, /kRetryIntervalMs = 60 \* 60'000LL/);
  assert.doesNotMatch(collector, /get_Headers|GetHeaders|put_Headers|Authorization:|Cookie:/);
  assert.match(collector, /spotify_artist_chart_capture_spool::Append\(normalized\)/);
  assert.match(collector, /capture\.Insert\(L"chart_date"/);
});

test('native app requests the Japan daily artist chart immediately at startup and then every hour', () => {
  assert.match(appMessages, /#include "spotify_artist_chart_collector\.h"/);
  assert.match(appMessages, /kSpotifyArtistChartInitialDelayMs = 250/);
  assert.match(appMessages, /kSpotifyArtistChartIntervalMs = 60 \* 60 \* 1000/);
  assert.match(appMessages, /SetTimer\(window, kSpotifyArtistChartTimer, kSpotifyArtistChartIntervalMs, nullptr\)/);
  assert.match(appMessages, /collector\.EnsureStarted\(now\)/);
  assert.match(appMessages, /collector\.RequestCaptureNow\(now\)/);
  assert.match(appMessages, /collector\.Tick\(now\)/);
  assert.match(appMessages, /collector\.ShowForDebug\(\)/);
  assert.match(appMessages, /kSpotifyArtistChartWatchTimer/);
  assert.match(appMessages, /StopSpotifyArtistChartCapture\(window\)/);
  assert.doesNotMatch(leaderboardHeader, /spotifyArtistChartCollector_/);
});

test('Spotify chart debug surface is startup-safe and avoids repeated full-screen compositor resizes', () => {
  assert.match(collectorHeader, /void RequestCaptureNow\(int64_t nowMs\) noexcept/);
  assert.match(collectorHeader, /nextCaptureAt_ = nowMs/);
  assert.match(collectorHeader, /debugController_ = nullptr/);
  assert.match(collectorHeader, /void ShowForDebug\(\) noexcept/);
  assert.match(collectorHeader, /GetWindowThreadProcessId\(window_, &processId\)/);
  assert.match(collectorHeader, /processId != GetCurrentProcessId\(\)/);
  assert.match(collectorHeader, /constexpr LONG kDebugWidth = 720/);
  assert.match(collectorHeader, /constexpr LONG kDebugHeight = 480/);
  assert.match(collectorHeader, /std::min\(availableWidth, kDebugWidth\)/);
  assert.match(collectorHeader, /std::min\(availableHeight, kDebugHeight\)/);
  assert.match(collectorHeader, /const bool controllerChanged = debugController_ != currentController/);
  assert.match(collectorHeader, /const bool boundsChanged = !EqualRect\(&debugBounds_, &bounds\)/);
  assert.match(collectorHeader, /if \(controllerChanged \|\| boundsChanged\)[\s\S]*controller_->put_Bounds\(bounds\)/);
  assert.match(collectorHeader, /if \(controllerChanged \|\| !debugVisible_\)[\s\S]*controller_->put_IsVisible\(TRUE\)/);
  assert.match(collector, /CreateCoreWebView2ControllerWithOptions/);
});

test('Spotify chart capture uses durable spool acknowledgement through device exchange', () => {
  assert.match(spool, /spotify-artist-jp-daily-capture\.ndjson/);
  assert.match(spool, /kMaxCaptureRecords = 8/);
  assert.match(spool, /kStationheadLeaderboardCaptureWakeMessage/);
  assert.match(exchange, /spotify_artist_chart_capture_spool::ReadBatch\(\)/);
  assert.match(exchange, /"spotifyArtistChart"/);
  assert.match(exchange, /spotify_artist_chart_capture_spool::Acknowledge/);
  assert.match(deviceExchange, /spotifyArtistChart\?: unknown/);
  assert.match(deviceExchange, /ingestSpotifyArtistChartInput/);
});

test('Cloud stores one snapshot per chart date and skips every hourly duplicate date', () => {
  assert.match(cloudCapture, /spotify\/charts\/artist-jp-daily\//);
  assert.match(cloudCapture, /latest\.json/);
  assert.match(chartIngest, /DATA_BUCKET/);
  assert.match(chartIngest, /bucket\.head\(`\$\{PREFIX\}\$\{chartDate\}\.json`\)/);
  assert.match(chartIngest, /if \(existing\) deduplicated \+= 1/);
  assert.match(chartIngest, /else fresh\.push\(record\)/);
  assert.match(chartIngest, /if \(fresh\.length\)[\s\S]*applySpotifyArtistChartInput\(fresh, env\)/);
  assert.match(chartIngest, /if \(d1Days > 0\)[\s\S]*requestReadModelRefresh/);
  assert.match(chartIngest, /message_type: READ_MODEL_REFRESH_TYPE/);
  assert.match(cloudConfig, /"binding": "SPOTIFY_PLAYCOUNT_QUEUE"/);
  assert.doesNotMatch(cloudCapture, /authorization|bearer|cookie/i);
});
