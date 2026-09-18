import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const readNative = name => readFileSync(
  new URL(`../../native/src/${name}`, import.meta.url), 'utf8');

const spotifyHeader = readNative('spotify_webviews.h');
const spotifyStatic = readNative('spotify_static_scripts.inc');
const spotifyRotation = readNative('spotify_rotation_cycle.inc');
const app = readNative('app.cpp');
const resourceFilter = readNative('sh_runtime_resource_filter_policy_fix.h');

test('Spotify exposes exactly five logical windows with amazon first and hinata fifth', () => {
  assert.match(spotifyHeader, /kSpotifyProfileFirstAccountNumber\s*=\s*1/);
  assert.match(spotifyHeader, /kSpotifyActiveAccountCount\s*=\s*5/);
  assert.match(
    spotifyStatic,
    /kSpotifyPanelNames\s*=\s*\{\s*L"amazon",\s*L"yuukiar",\s*L"ten",\s*L"nagi",\s*L"hinata"\s*\}/);
});

test('Spotify five-window rotation uses four live lanes and one waiting account', () => {
  assert.match(spotifyHeader, /kSpotifyRuntimeLaneCount\s*=\s*4/);
  assert.match(spotifyHeader, /gSpotifyRuntimeLaneAccounts\s*=\s*\{\s*0,\s*1,\s*2,\s*3\s*\}/);
  assert.match(spotifyHeader, /gSpotifyInactiveAccountIndex\s*=\s*4/);
  assert.match(spotifyRotation, /amazon=A, yuukiar=B, ten=C, nagi=D, hinata=E/);
});

test('Stationhead uses the restored ozeki WebView2 profile', () => {
  assert.match(app, /kStationheadOzekiProfile\[\]\s*=\s*L"spotify-v2-6"/);
  assert.match(app, /ReuseWebViewProfile\(kStationheadOzekiProfile\)/);
  assert.match(resourceFilter, /_wcsicmp\(profileNameRaw, L"spotify-v2-6"\)/);
  assert.doesNotMatch(app, /kStationheadAmazonProfile/);
});

test('Spotify startup remains staggered at 30-second offsets for four live lanes', () => {
  assert.match(spotifyHeader, /kSpotifyAccountStartOffsetMs\s*=\s*30ULL \* 1000ULL/);
  assert.match(app, /Spotify #1 at \+30s, Spotify #2 at \+60s, Spotify #3 at \+90s, Spotify #4 at \+120s/);
});
