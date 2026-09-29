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

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

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

test('native app starts the visible Japan daily artist chart at startup without relying on a delay workaround', () => {
  assert.match(appMessages, /#include "spotify_artist_chart_collector\.h"/);
  assert.match(appMessages, /kSpotifyArtistChartInitialDelayMs = 250/);
  assert.doesNotMatch(appMessages, /kSpotifyArtistChartStartupRetryMs/);
  assert.doesNotMatch(appMessages, /RearmSpotifyArtistChartAfterStartup/);
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

test('Spotify chart controller teardown invalidates late callbacks and runs outside WebView callbacks', () => {
  const complete = section(
    collector,
    'inline void SpotifyArtistChartCollector::CompleteCapture(',
    'inline void SpotifyArtistChartCollector::FailCapture(',
  );
  const failure = section(
    collector,
    'inline void SpotifyArtistChartCollector::FailCapture(',
    'inline void SpotifyArtistChartCollector::ScheduleControllerTeardown(',
  );
  const tick = section(
    collector,
    'inline void SpotifyArtistChartCollector::Tick(',
    'inline void SpotifyArtistChartCollector::BeginCapture(',
  );

  assert.match(collectorHeader, /teardownPending_/);
  assert.match(collectorHeader, /teardownAt_/);
  assert.match(collectorHeader, /creating_ \|\| captureInFlight_ \|\| teardownPending_/);
  assert.match(complete, /\+\+generation_/);
  assert.match(complete, /ScheduleControllerTeardown\(nowMs\)/);
  assert.doesNotMatch(complete, /CloseController\(\)/);
  assert.match(failure, /\+\+generation_/);
  assert.match(failure, /ScheduleControllerTeardown\(nowMs\)/);
  assert.doesNotMatch(failure, /CloseController\(\)/);
  assert.match(tick, /if \(teardownPending_\)/);
  assert.match(tick, /CloseController\(\)/);
  assert.match(tick, /environment_\.Reset\(\)/);
  assert.match(collector, /include\(teardownAt_\)/);
});

test('Spotify chart debug surface is bounded and stops touching a controller pending teardown', () => {
  assert.match(collectorHeader, /void RequestCaptureNow\(int64_t nowMs\) noexcept/);
  assert.match(collectorHeader, /nextCaptureAt_ = nowMs/);
  assert.match(collectorHeader, /debugController_ = nullptr/);
  assert.match(collectorHeader, /void ShowForDebug\(\) noexcept/);
  assert.match(collectorHeader, /if \(teardownPending_ \|\| !controller_/);
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
