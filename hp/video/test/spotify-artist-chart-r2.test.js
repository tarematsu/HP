import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const url = relative => new URL(relative, import.meta.url);
const read = relative => readFileSync(url(relative), 'utf8');

const appMessages = read('../../native/src/app_messages.cpp');
const exchange = read('../../native/src/cloud_client_exchange.inc');
const leaderboardCollector = read('../../native/src/stationhead_leaderboard_collector.cpp');
const leaderboardSpool = read('../../native/src/stationhead_leaderboard_capture_spool.h');
const hourlySchedule = read('../../native/src/hourly_collection_schedule.h');
const cloudCapture = read('../../cloud/src/spotify_artist_chart_capture.ts');
const chartIngest = read('../../cloud/src/spotify_artist_chart_ingest.ts');
const deviceExchange = read('../../cloud/src/device_exchange_payload.ts');

test('native app no longer collects or uploads Spotify Japan Daily Top Artist', () => {
  assert.equal(existsSync(url('../../native/src/spotify_artist_chart_collector.h')), false);
  assert.equal(existsSync(url('../../native/src/spotify_artist_chart_collector.inl')), false);
  assert.equal(existsSync(url('../../native/src/spotify_artist_chart_capture_spool.h')), false);

  assert.doesNotMatch(appMessages, /spotify_artist_chart|SpotifyArtistChart|spotifyArtistChart/);
  assert.doesNotMatch(appMessages, /kSpotifyArtistChartTimer|kSpotifyArtistChartWatchTimer/);
  assert.doesNotMatch(appMessages, /NextHourlyCollectionSlot/);
  assert.doesNotMatch(exchange, /spotify_artist_chart|SpotifyArtistChart|spotifyArtistChart/);
});

test('Stationhead leaderboard collection and native upload remain enabled', () => {
  assert.match(hourlySchedule, /kHourlyCollectionIntervalMs = 60 \* 60'000LL/);
  assert.match(leaderboardCollector, /kStationheadCollectionPhaseMinute = 0/);
  assert.match(
    leaderboardCollector,
    /NextHourlyCollectionSlot\(nowMs, kStationheadCollectionPhaseMinute\)/,
  );
  assert.match(leaderboardCollector, /PowerSavingController::IsPowerSavingActive\(\)/);
  assert.match(leaderboardCollector, /stationhead_leaderboard_capture_spool::Append/);
  assert.match(leaderboardSpool, /stationhead-leaderboard-capture\.ndjson/);

  assert.match(appMessages, /kStationheadLeaderboardCaptureWakeMessage/);
  assert.match(appMessages, /ScheduleNextTick\(1\)/);
  assert.match(appMessages, /cloud_->RefreshNow\(\)/);
  assert.match(exchange, /stationhead_leaderboard_capture_spool::ReadBatch\(\)/);
  assert.match(exchange, /"leaderboardProbe"/);
  assert.match(exchange, /stationhead_leaderboard_capture_spool::Acknowledge/);
});

test('Cloud keeps Spotify Daily Top Artist history and old-client ingest compatibility', () => {
  assert.match(cloudCapture, /spotify\/charts\/artist-jp-daily\//);
  assert.match(cloudCapture, /latest\.json/);
  assert.match(chartIngest, /applySpotifyArtistChartInput/);
  assert.match(chartIngest, /syncSpotifyArtistChartR2ToD1/);
  assert.match(deviceExchange, /spotifyArtistChart\?: unknown/);
  assert.match(deviceExchange, /ingestSpotifyArtistChartInput/);
});
