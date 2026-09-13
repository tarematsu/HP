import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);
const foundation = readFileSync(
  new URL('../../native/src/spotify_webview_foundation.inc', import.meta.url),
  'utf8',
);
const controller = readFileSync(
  new URL('../../native/src/spotify_controller_lifecycle.inc', import.meta.url),
  'utf8',
);
const spotify = `${foundation}\n${controller}`;

test('Spotify one-time reauthentication keeps stable v2 profiles after amazon moves to Stationhead', () => {
  assert.match(foundation, /kSpotifyProfilePrefix\[\] = L"spotify-" L"v2-"/);
  assert.match(foundation, /Keep this namespace stable after the reauthentication rollout/);
  assert.match(header, /kSpotifyProfileFirstAccountNumber = 2/);
  assert.match(controller, /target->index \+ kSpotifyProfileFirstAccountNumber/);
  assert.match(controller, /put_ProfileName\(profileName\.c_str\(\)\)/);
});

test('reauthentication does not clear shared WebView data in-place', () => {
  assert.doesNotMatch(
    spotify,
    /DeleteAllCookies|ClearBrowsingData|ClearBrowsingDataInTimeRange|RemoveAllCookies/,
  );
});
