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

test('legacy Spotify implementation still describes the five reusable profiles', () => {
  assert.match(spotifyHeader, /kSpotifyProfileFirstAccountNumber\s*=\s*1/);
  assert.match(spotifyHeader, /kSpotifyActiveAccountCount\s*=\s*5/);
  assert.match(
    spotifyStatic,
    /kSpotifyPanelNames\s*=\s*\{\s*L"amazon",\s*L"yuukiar",\s*L"ten",\s*L"nagi",\s*L"hinata"\s*\}/);
});

test('legacy Spotify source keeps its fixed one-to-one lane metadata without being started by App', () => {
  assert.match(spotifyHeader, /kSpotifyRuntimeLaneCount\s*=\s*kSpotifyActiveAccountCount/);
  assert.match(
    spotifyHeader,
    /return accountIndex < kSpotifyRuntimeLaneCount[\s\S]*static_cast<int>\(accountIndex\)/,
  );
  assert.match(spotifyHeader, /return accountIndex < kSpotifyActiveAccountCount/);
  assert.doesNotMatch(spotifyHeader, /gSpotifyRuntimeLaneAccounts/);
  assert.doesNotMatch(spotifyHeader, /gSpotifyInactiveAccountIndex/);
  assert.match(spotifyRotation, /amazon=A, yuukiar=B, ten=C, nagi=D, hinata=A/);
  assert.doesNotMatch(app, /renderer_->StartSpotify\(\)/);
});

test('Stationhead fleet reuses all six existing WebView2 profiles', () => {
  assert.match(app, /kStationheadPeerProfiles\{[\s\S]*spotify-v2-1[\s\S]*spotify-v2-5/);
  assert.match(app, /kStationheadOzekiProfile\[\]\s*=\s*L"spotify-v2-6"/);
  assert.match(app, /ReuseWebViewProfile\(kStationheadPeerProfiles\[i\]\)/);
  assert.match(app, /ReuseWebViewProfile\(kStationheadOzekiProfile\)/);
  assert.match(resourceFilter, /_wcsicmp\(profileNameRaw, L"spotify-v2-6"\)/);
  assert.doesNotMatch(app, /kStationheadAmazonProfile/);
});

test('Stationhead controller startup is staggered at thirty-second offsets', () => {
  assert.match(app, /kMediaStartupStageDelayMs \* static_cast<int64_t>\(i \+ 1\)/);
  assert.match(app, /kMediaStartupStageDelayMs \* 6/);
  assert.match(app, /Stationhead #6 launch issued at \+180 seconds/);
});
