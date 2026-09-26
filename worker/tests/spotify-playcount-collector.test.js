import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_ALBUM_TRACKS_QUERY_HASH,
  SPOTIFY_TARGET_ARTISTS,
  albumTracksRequestUrl,
  jstDateKey,
  normalizeAlbumTracks,
} from '../src/spotify-playcount-collector.js';

test('daily snapshot date is keyed in JST', () => {
  assert.equal(jstDateKey(Date.UTC(2026, 8, 26, 21, 5, 0)), '2026-09-27');
  assert.equal(jstDateKey(Date.UTC(2026, 8, 26, 14, 59, 59)), '2026-09-26');
  assert.equal(jstDateKey(Date.UTC(2026, 8, 26, 15, 0, 0)), '2026-09-27');
});

test('collector targets all three Sakamichi groups', () => {
  assert.deepEqual(
    SPOTIFY_TARGET_ARTISTS.map(({ artist_key, spotify_artist_id }) => [
      artist_key,
      spotify_artist_id,
    ]),
    [
      ['nogizaka46', '08lN7bm4Etec8ETFxaTUmq'],
      ['sakurazaka46', '0Ti7MfCiVVQAK8zLSiqlto'],
      ['hinatazaka46', '0eQSoTI7sQENREQM8Klp2j'],
    ],
  );
});

test('album GraphQL request uses the configured persisted query', () => {
  const url = new URL(albumTracksRequestUrl('album-123'));
  assert.equal(url.origin, 'https://api-partner.spotify.com');
  assert.equal(url.searchParams.get('operationName'), 'queryAlbumTracks');
  assert.deepEqual(JSON.parse(url.searchParams.get('variables')), {
    uri: 'spotify:album:album-123',
    offset: 0,
    limit: 300,
  });
  assert.equal(
    JSON.parse(url.searchParams.get('extensions')).persistedQuery.sha256Hash,
    DEFAULT_ALBUM_TRACKS_QUERY_HASH,
  );
});

test('album normalizer keeps only tracks credited to a target group', () => {
  const targets = [
    { artist_key: 'sakurazaka46', spotify_artist_id: 'target-artist' },
  ];
  const payload = {
    data: {
      album: {
        tracks: {
          items: [
            {
              track: {
                uri: 'spotify:track:wanted',
                name: 'Wanted',
                playcount: '123456',
                discNumber: 1,
                trackNumber: 2,
                duration: { totalMilliseconds: 205000 },
                artists: {
                  items: [
                    { uri: 'spotify:artist:target-artist', profile: { name: '櫻坂46' } },
                    { uri: 'spotify:artist:guest', profile: { name: 'Guest' } },
                  ],
                },
              },
            },
            {
              track: {
                uri: 'spotify:track:not-target',
                name: 'Compilation track',
                playcount: '999',
                artists: {
                  items: [
                    { uri: 'spotify:artist:somebody-else', profile: { name: 'Other' } },
                  ],
                },
              },
            },
            {
              track: {
                uri: 'spotify:track:missing-count',
                name: 'No count',
                artists: {
                  items: [
                    { uri: 'spotify:artist:target-artist', profile: { name: '櫻坂46' } },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  };

  assert.deepEqual(normalizeAlbumTracks(payload, targets), [
    {
      track_id: 'wanted',
      name: 'Wanted',
      playcount: 123456,
      disc_number: 1,
      track_number: 2,
      duration_ms: 205000,
      artists_json: JSON.stringify([
        { id: 'target-artist', name: '櫻坂46' },
        { id: 'guest', name: 'Guest' },
      ]),
      target_keys: ['sakurazaka46'],
    },
  ]);
});

test('normalizer accepts albumUnion response shape used by newer Web Player queries', () => {
  const tracks = normalizeAlbumTracks({
    data: {
      albumUnion: {
        tracks: {
          items: [{
            track: {
              id: 'track-v2',
              name: 'V2 track',
              playcount: '42',
              artists: { items: [{ id: 'target-v2', name: '日向坂46' }] },
            },
          }],
        },
      },
    },
  }, [{ artist_key: 'hinatazaka46', spotify_artist_id: 'target-v2' }]);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].track_id, 'track-v2');
  assert.equal(tracks[0].playcount, 42);
});
