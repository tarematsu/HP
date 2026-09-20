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

test('media startup launches six Stationhead windows at thirty-second offsets', () => {
  assert.match(appHeader, /kMediaStartupStageDelayMs\s*=\s*30'000/);
  assert.match(appHeader, /kStationheadPeerCount\s*=\s*5/);
  assert.doesNotMatch(appHeader, /spotifyStarted_/);
  assert.match(app, /kStationheadPeerProfiles\{[\s\S]*spotify-v2-1[\s\S]*spotify-v2-5/);
  assert.match(app, /kStationheadOzekiProfile\[\]\s*=\s*L"spotify-v2-6"/);

  const startup = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  assert.match(startup, /renderer_->Initialize\(\)/);
  assert.doesNotMatch(startup, /stationhead_->Start\(\)/);
  assert.doesNotMatch(startup, /renderer_->StartSpotify\(\)/);
  assert.match(startup, /ReuseWebViewProfile\(kStationheadPeerProfiles\[i\]\)/);
  assert.match(startup, /ReuseWebViewProfile\(kStationheadOzekiProfile\)/);

  const deferred = section(app, 'void App::StartDeferredServices(', 'void App::StopServices()');
  assert.doesNotMatch(deferred, /renderer_->StartSpotify\(\)/);
  assert.match(deferred, /stationheadPeers_\[i\]->Start\(\)/);
  assert.match(
    deferred,
    /kMediaStartupStageDelayMs\s*\*\s*static_cast<int64_t>\(i \+ 1\)/,
  );
  assert.match(
    deferred,
    /now\s*-\s*startupAt_\s*>=\s*kMediaStartupStageDelayMs\s*\*\s*6[\s\S]*stationhead_->Start\(\)/,
  );
  assert.match(deferred, /Stationhead peer #[\s\S]*launch issued at \+/);
  assert.match(deferred, /Stationhead #6 launch issued at \+180 seconds/);
});

test('legacy Spotify renderer entry point is not part of app startup anymore', () => {
  const initialize = section(lifecycle, 'void Renderer::Initialize()', 'void Renderer::StartSpotify()');
  assert.doesNotMatch(initialize, /gSpotifyWebViews->Start\(\)/);

  const startup = section(app, 'void App::StartServices()', 'void App::StartDeferredServices(');
  const deferred = section(app, 'void App::StartDeferredServices(', 'void App::StopServices()');
  assert.doesNotMatch(startup, /StartSpotify\(\)/);
  assert.doesNotMatch(deferred, /StartSpotify\(\)/);
});
