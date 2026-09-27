import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(relative, import.meta.url), 'utf8');

const collectorHeader = read('../../native/src/spotify_artist_chart_collector.h');
const collector = read('../../native/src/spotify_artist_chart_collector.inl');
const spool = read('../../native/src/spotify_artist_chart_capture_spool.h');
const leaderboardHeader = read('../../native/src/stationhead_leaderboard_collector.h');
const exchange = read('../../native/src/cloud_client_exchange.inc');
const cloudCapture = read('../../cloud/src/spotify_artist_chart_capture.ts');
const deviceExchange = read('../../cloud/src/device_exchange_payload.ts');

test('Spotify Japan daily artist chart uses the authenticated Stationhead WebView2 profile without exporting credentials', () => {
  assert.match(collectorHeader, /profileName_\{L"spotify-v2-6"\}/);
  assert.match(collector, /charts\.spotify\.com\/charts\/view\/artist-jp-daily\/latest/);
  assert.match(collector, /charts-spotify-com-service\.spotify\.com\/auth\/v0\/charts\/artist-jp-daily\//);
  assert.match(collector, /add_WebResourceResponseReceived/);
  assert.match(collector, /GetContent/);
  assert.match(collector, /kDailyCaptureOffsetMs = \(7 \* 60 \+ 20\) \* 60'000LL/);
  assert.match(collector, /kRetryIntervalMs = 60 \* 60'000LL/);
  assert.doesNotMatch(collector, /get_Headers|GetHeaders|put_Headers|Authorization:|Cookie:/);
  assert.match(collector, /spotify_artist_chart_capture_spool::Append\(normalized\)/);
});

test('Spotify chart collector is driven by the existing leaderboard scheduler but remains a separate WebView', () => {
  assert.match(leaderboardHeader, /#include "spotify_artist_chart_collector\.h"/);
  assert.match(leaderboardHeader, /mutable SpotifyArtistChartCollector spotifyArtistChartCollector_/);
  assert.match(leaderboardHeader, /spotifyArtistChartCollector_\.EnsureStarted\(now\)/);
  assert.match(leaderboardHeader, /spotifyArtistChartCollector_\.Tick\(now\)/);
  assert.match(collector, /CreateCoreWebView2ControllerWithOptions/);
  assert.match(collector, /RECT bounds\{0, 0, 1, 1\}/);
});

test('Spotify chart capture uses durable spool acknowledgement through device exchange', () => {
  assert.match(spool, /spotify-artist-jp-daily-capture\.ndjson/);
  assert.match(spool, /kMaxCaptureRecords = 8/);
  assert.match(spool, /kStationheadLeaderboardCaptureWakeMessage/);
  assert.match(exchange, /spotify_artist_chart_capture_spool::ReadBatch\(\)/);
  assert.match(exchange, /"spotifyArtistChart"/);
  assert.match(exchange, /spotify_artist_chart_capture_spool::Acknowledge/);
  assert.match(deviceExchange, /spotifyArtistChart\?: unknown/);
  assert.match(deviceExchange, /applySpotifyArtistChartInput/);
});

test('Cloud stores date snapshots and latest in R2 without allowing stale latest rollback', () => {
  assert.match(cloudCapture, /spotify\/charts\/artist-jp-daily\//);
  assert.match(cloudCapture, /latest\.json/);
  assert.match(cloudCapture, /DATA_BUCKET\.head/);
  assert.match(cloudCapture, /observedAt/);
  assert.match(cloudCapture, /isNewerOrEqual/);
  assert.match(cloudCapture, /chart_date > previous\.chart_date/);
  assert.match(cloudCapture, /entry_count: capture\.entries\.length/);
  assert.doesNotMatch(cloudCapture, /authorization|bearer|cookie/i);
});
