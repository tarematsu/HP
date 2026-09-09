import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const core1 = readFileSync(
  new URL('../../native/src/spotify_webviews_core_part1.inc', import.meta.url),
  'utf8',
);
const core2 = readFileSync(
  new URL('../../native/src/spotify_webviews_core_part2.inc', import.meta.url),
  'utf8',
);
const spotify = `${core1}\n${core2}`;

test('Spotify one-time reauthentication uses a stable v2 named-profile namespace', () => {
  assert.match(core1, /kSpotifyProfilePrefix\[\] = L"spotify-" L"v2-"/);
  assert.match(core1, /Keep this namespace stable after the reauthentication rollout/);
  assert.match(core2, /std::to_wstring\(target->index \+ 1\)/);
  assert.match(core2, /put_ProfileName\(profileName\.c_str\(\)\)/);
});

test('reauthentication does not clear shared WebView data in-place', () => {
  assert.doesNotMatch(
    spotify,
    /DeleteAllCookies|ClearBrowsingData|ClearBrowsingDataInTimeRange|RemoveAllCookies/,
  );
});
