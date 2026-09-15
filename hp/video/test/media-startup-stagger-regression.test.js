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

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('media startup is YouTube then Stationhead then Spotify with ten second gaps', () => {
  assert.match(appHeader, /kMediaStartupStageDelayMs\s*=\s*10'000/);

  const startup = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  assert.match(startup, /renderer_->Initialize\(\)/);
  assert.doesNotMatch(startup, /stationhead_->Start\(\)/);
  assert.doesNotMatch(startup, /StartSpotify\(\)/);

  const deferred = section(app, 'void App::StartDeferredServices(', 'void App::StopServices()');
  const stationheadAt = deferred.indexOf('stationhead_->Start()');
  const spotifyAt = deferred.indexOf('renderer_->StartSpotify()');
  assert.ok(stationheadAt >= 0, 'Stationhead staged start is missing');
  assert.ok(spotifyAt > stationheadAt, 'Spotify must start after Stationhead');
  assert.match(
    deferred,
    /now\s*-\s*startupAt_\s*>=\s*kMediaStartupStageDelayMs[\s\S]*stationhead_->Start\(\)/,
  );
  assert.match(
    deferred,
    /now\s*-\s*stationheadStartedAt_\s*>=\s*kMediaStartupStageDelayMs[\s\S]*renderer_->StartSpotify\(\)/,
  );
});

test('renderer initialization no longer starts Spotify alongside YouTube', () => {
  const initialize = section(lifecycle, 'void Renderer::Initialize()', 'void Renderer::StartSpotify()');
  assert.doesNotMatch(initialize, /gSpotifyWebViews->Start\(\)/);

  const spotify = section(lifecycle, 'void Renderer::StartSpotify()', 'void Renderer::Resize(');
  assert.match(spotify, /gSpotifyWebViews->Start\(\)/);
});
