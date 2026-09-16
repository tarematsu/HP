import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = relative => readFileSync(
  new URL(`../../native/src/${relative}`, import.meta.url),
  'utf8',
);

const app = readNative('app.cpp');
const appHeader = readNative('app.h');
const lifecycle = readNative('renderer_lifecycle.cpp');
const spotifyHeader = readNative('spotify_webviews.h');
const spotifySchedule = readNative('spotify_stagger_schedule.inc');

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('media startup is YouTube, Spotify 1, Spotify 2, then Stationhead at ten-second offsets', () => {
  assert.match(appHeader, /kMediaStartupStageDelayMs\s*=\s*10'000/);
  assert.doesNotMatch(appHeader, /spotifyStartedAt_/);
  assert.match(spotifyHeader, /kSpotifyActiveAccountCount = 2/);
  assert.match(spotifyHeader, /kSpotifyAccountStartOffsetMs = 10ULL \* 1000ULL/);
  assert.match(spotifySchedule, /kSpotifyInitialStartDelayMs = 0/);

  const startup = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  assert.match(startup, /renderer_->Initialize\(\)/);
  assert.doesNotMatch(startup, /stationhead_->Start\(\)/);
  assert.doesNotMatch(startup, /StartSpotify\(\)/);

  const deferred = section(app, 'void App::StartDeferredServices(', 'void App::StopServices()');
  const spotifyAt = deferred.indexOf('renderer_->StartSpotify()');
  const stationheadAt = deferred.indexOf('stationhead_->Start()');
  assert.ok(spotifyAt >= 0, 'Spotify staged start is missing');
  assert.ok(stationheadAt > spotifyAt, 'Stationhead launch must be issued after Spotify launch');
  assert.match(
    deferred,
    /now\s*-\s*startupAt_\s*>=\s*kMediaStartupStageDelayMs[\s\S]*renderer_->StartSpotify\(\)/,
  );
  assert.match(
    deferred,
    /now\s*-\s*startupAt_\s*>=\s*kMediaStartupStageDelayMs\s*\*\s*3[\s\S]*stationhead_->Start\(\)/,
  );
  assert.doesNotMatch(deferred, /spotifyStartedAt_/);
});

test('renderer initialization no longer starts Spotify alongside YouTube', () => {
  const initialize = section(lifecycle, 'void Renderer::Initialize()', 'void Renderer::StartSpotify()');
  assert.doesNotMatch(initialize, /gSpotifyWebViews->Start\(\)/);

  const spotify = section(lifecycle, 'void Renderer::StartSpotify()', 'void Renderer::Resize(');
  assert.match(spotify, /gSpotifyWebViews->Start\(\)/);
});
