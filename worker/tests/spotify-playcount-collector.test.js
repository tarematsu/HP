import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SPOTIFY_TARGET_ARTISTS,
  albumFromInitialState,
  albumIdsFromDiscographyHtml,
  decodeSpotifyInitialState,
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

test('public discography page discovers album ids without Spotify Web API', () => {
  const renderedId = '1234567890123456789012';
  const stateId = 'abcdefghijklmnopqrstuv';
  const state = {
    nested: {
      releases: [
        { uri: `spotify:album:${stateId}` },
      ],
    },
  };
  const encoded = Buffer.from(JSON.stringify(state), 'utf8').toString('base64');
  const html = [
    `<a href="https://open.spotify.com/album/${renderedId}">release</a>`,
    `<script id="initialState" type="text/plain">${encoded}</script>`,
  ].join('');
  assert.deepEqual(
    new Set(albumIdsFromDiscographyHtml(html)),
    new Set([renderedId, stateId]),
  );
});

test('public album page initialState is decoded and album entity is selected', () => {
  const album = {
    uri: 'spotify:album:album-123',
    name: 'Test album',
    tracks: { items: [] },
  };
  const state = {
    entities: {
      items: {
        'spotify:album:album-123': album,
      },
    },
  };
  const encoded = Buffer.from(JSON.stringify(state), 'utf8').toString('base64');
  const html = `<html><script id="initialState" type="text/plain">${encoded}</script></html>`;
  assert.deepEqual(albumFromInitialState(decodeSpotifyInitialState(html), 'album-123'), album);
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

test('normalizer falls back to album artists when track rows omit artists', () => {
  const tracks = normalizeAlbumTracks({
    uri: 'spotify:album:album-public',
    artists: {
      items: [{ uri: 'spotify:artist:target-v2', profile: { name: '日向坂46' } }],
    },
    tracks: {
      items: [{
        track: {
          uri: 'spotify:track:track-v2',
          name: 'Public page track',
          playcount: '42',
          duration: { totalMilliseconds: 180000 },
        },
      }],
    },
  }, [{ artist_key: 'hinatazaka46', spotify_artist_id: 'target-v2' }]);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].track_id, 'track-v2');
  assert.equal(tracks[0].playcount, 42);
  assert.deepEqual(tracks[0].target_keys, ['hinatazaka46']);
});
