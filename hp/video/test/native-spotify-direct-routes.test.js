import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = readFileSync(
  new URL('../../native/src/spotify_fallback_catalog.inc', import.meta.url),
  'utf8',
);
const cloud = readFileSync(
  new URL('../../native/src/spotify_cloud_playlist.inc', import.meta.url),
  'utf8',
);

test('all fallback catalog entries keep direct Spotify track routes', () => {
  assert.doesNotMatch(catalog, /spotify_recent_direct_routes\.inc/);
  const declaredSize = Number(
    catalog.match(/std::array<SpotifyFallbackCatalogTrack, (\d+)>/)?.[1] ?? 0,
  );
  const start = catalog.indexOf('kSpotifyFallbackCatalogTracks = {{');
  const end = catalog.indexOf('}};', start);
  assert.ok(start >= 0 && end > start);
  const section = catalog.slice(start, end);
  const entries = [...section.matchAll(
    /\{L"[^"]+", L"https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})", L"\/track\/\1"\}/g,
  )];
  assert.ok(declaredSize > 0);
  assert.equal(entries.length, declaredSize);
  const ids = entries.map((entry) => entry[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('3GdsVS4jIJ7RBiasVZlWul'));
});

test('cloud track routes are validated as direct open.spotify.com track ids', () => {
  assert.match(cloud, /ManagedSpotifyPathFromUrl\(url, L"\/track\/"\)/);
  assert.match(cloud, /https:\/\/open\.spotify\.com/);
  assert.match(cloud, /return url\.substr\(begin, end - begin\)/);
});
