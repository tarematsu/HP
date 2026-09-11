import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const foundation = readFileSync(
  new URL('../../native/src/spotify_webview_foundation.inc', import.meta.url),
  'utf8',
);
const controller = readFileSync(
  new URL('../../native/src/spotify_controller_lifecycle.inc', import.meta.url),
  'utf8',
);
const spotify = `${foundation}\n${controller}`;

test('Spotify one-time reauthentication uses a stable v2 named-profile namespace', () => {
  assert.match(foundation, /kSpotifyProfilePrefix\[\] = L"spotify-" L"v2-"/);
  assert.match(foundation, /Keep this namespace stable after the reauthentication rollout/);
  assert.match(controller, /std::to_wstring\(target->index \+ 1\)/);
  assert.match(controller, /put_ProfileName\(profileName\.c_str\(\)\)/);
});

test('reauthentication does not clear shared WebView data in-place', () => {
  assert.doesNotMatch(
    spotify,
    /DeleteAllCookies|ClearBrowsingData|ClearBrowsingDataInTimeRange|RemoveAllCookies/,
  );
});
