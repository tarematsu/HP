import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const catalog = readFileSync(
  new URL('../../native/src/spotify_recent_catalog.inc', import.meta.url),
  'utf8',
);

test('all 35 recent catalog entries carry their direct Spotify track route in one table', () => {
  assert.doesNotMatch(catalog, /spotify_recent_direct_routes\.inc/);
  const section = catalog.slice(
    catalog.indexOf('kSpotifyRecentCatalogTracks = {{'),
    catalog.indexOf('static_assert(kSpotifyRecentCatalogTracks.size() == 35)'),
  );
  assert.equal(
    (section.match(/https:\/\/open\.spotify\.com\/track\//g) || []).length,
    35,
  );
  assert.equal((section.match(/L"\/track\//g) || []).length, 35);

  for (const id of [
    '33liCluqUasE65nMv3KLLm',
    '5QnQ7m9OxSoFeSPSz8grqX',
    '2CMSkSwIfnNQR7bTNFFeB5',
    '2meBhRDzQpf0ltQH11HbWG',
  ]) {
    assert.equal((section.match(new RegExp(id, 'g')) || []).length, 2);
  }
});
