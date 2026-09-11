import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url),
  'utf8',
);
const cloud = readFileSync(
  new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url),
  'utf8',
);

test('all nine short fallback catalog entries keep direct Spotify track routes', () => {
  assert.doesNotMatch(catalog, /spotify_recent_direct_routes\.inc/);
  const start = catalog.indexOf('kSpotifyFallbackCatalogTracks = {{');
  const end = catalog.indexOf('}};', start);
  assert.ok(start >= 0 && end > start);
  const section = catalog.slice(start, end);
  assert.equal(
    (section.match(/https:\/\/open\.spotify\.com\/track\//g) || []).length,
    9,
  );
  assert.equal((section.match(/L"\/track\//g) || []).length, 9);

  for (const id of [
    '5xUQGRuP4LPk4ESl1xbmFs',
    '4PaLKbIU8NvguxcrjMvHXh',
    '6GF0ZgT8wlksWrlLTfGmlU',
    '5vRGSkQiKlJudkJ2vUKIOe',
    '6QmAwjzLQy6SjUyvGzSCG4',
    '7vvZ1QHTdkoEXBiOBdxdIo',
    '3HdmFZGqZLNiCAfiNj4N84',
    '5DrxCKjopmd7UL1pJWqBHK',
    '2hi8kIoKC8tRMDajdkoYFL',
  ]) {
    assert.equal((section.match(new RegExp(id, 'g')) || []).length, 2);
  }
});

test('cloud track routes are validated as direct open.spotify.com track ids', () => {
  assert.match(cloud, /ManagedSpotifyPathFromUrl\(url, L"\/track\/"\)/);
  assert.match(cloud, /https:\/\/open\.spotify\.com/);
  assert.match(cloud, /return url\.substr\(begin, end - begin\)/);
});
