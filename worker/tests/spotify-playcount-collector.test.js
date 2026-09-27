import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  SPOTIFY_TARGET_ARTISTS,
  countPlaycountRegressions,
  hasPlaycountAdvance,
  jstDateKey,
  jstHour,
  normalizeAlbumTracks,
  parseSpotifyEmbedSession,
  releasesFromArtistDiscography,
  shouldRetryRun,
} from '../src/spotify-playcount-collector.js';

test('daily snapshot date is keyed in JST', () => {
  assert.equal(jstDateKey(Date.UTC(2026, 8, 26, 21, 5, 0)), '2026-09-27');
  assert.equal(jstDateKey(Date.UTC(2026, 8, 26, 14, 59, 59)), '2026-09-26');
  assert.equal(jstDateKey(Date.UTC(2026, 8, 26, 15, 0, 0)), '2026-09-27');
  assert.equal(jstHour(Date.UTC(2026, 8, 26, 20, 0, 0)), 5);
});

test('collector targets all three Sakamichi groups', () => {
  assert.deepEqual(
    SPOTIFY_TARGET_ARTISTS.map(({ artist_key, spotify_artist_id }) => [artist_key, spotify_artist_id]),
    [
      ['nogizaka46', '08lN7bm4Etec8ETFxaTUmq'],
      ['sakurazaka46', '0Ti7MfCiVVQAK8zLSiqlto'],
      ['hinatazaka46', '0eQSoTI7sQENREQM8Klp2j'],
    ],
  );
});

test('public embed page exposes an ephemeral anonymous web session', () => {
  const state = {
    props: {
      pageProps: {
        state: {
          settings: {
            session: {
              accessToken: 'anonymous-token',
              accessTokenExpirationTimestampMs: 1790481823269,
              isAnonymous: true,
            },
          },
        },
      },
    },
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state)}</script>`;
  assert.deepEqual(parseSpotifyEmbedSession(html), {
    accessToken: 'anonymous-token',
    accessTokenExpirationTimestampMs: 1790481823269,
    isAnonymous: true,
  });
});

test('Pathfinder full discography payload is normalized and deduplicated', () => {
  const payload = {
    data: {
      artistUnion: {
        discography: {
          all: {
            items: [
              {
                releases: {
                  items: [
                    {
                      id: 'album-1',
                      uri: 'spotify:album:album-1',
                      name: 'Single A',
                      type: 'SINGLE',
                      date: { isoString: '2026-09-10T00:00:00Z', precision: 'DAY' },
                      tracks: { totalCount: 1 },
                    },
                  ],
                },
              },
              {
                releases: {
                  items: [
                    {
                      id: 'album-1',
                      uri: 'spotify:album:album-1',
                      name: 'Single A',
                      type: 'SINGLE',
                      date: { isoString: '2026-09-10T00:00:00Z', precision: 'DAY' },
                      tracks: { totalCount: 1 },
                    },
                    {
                      uri: 'spotify:album:album-2',
                      name: 'Album B',
                      type: 'ALBUM',
                      date: { year: 2025, month: 12, day: 3, precision: 'DAY' },
                      tracks: { totalCount: 12 },
                    },
                  ],
                },
              },
            ],
          },
        },
      },
    },
  };

  assert.deepEqual(releasesFromArtistDiscography(payload), [
    {
      album_id: 'album-1',
      name: 'Single A',
      album_type: 'single',
      release_date: '2026-09-10',
      release_date_precision: 'day',
      total_tracks: 1,
    },
    {
      album_id: 'album-2',
      name: 'Album B',
      album_type: 'album',
      release_date: '2025-12-03',
      release_date_precision: 'day',
      total_tracks: 12,
    },
  ]);
});

test('album normalizer keeps only tracks credited to a target group', () => {
  const targets = [{ artist_key: 'sakurazaka46', spotify_artist_id: 'target-artist' }];
  const payload = {
    data: {
      album: {
        tracks: {
          items: [
            {
              track: {
                id: 'wanted',
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
                id: 'not-target',
                name: 'Compilation track',
                playcount: '999',
                artists: { items: [{ uri: 'spotify:artist:other', profile: { name: 'Other' } }] },
              },
            },
            {
              track: {
                id: 'missing-count',
                name: 'No count',
                artists: { items: [{ uri: 'spotify:artist:target-artist', profile: { name: '櫻坂46' } }] },
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
    artists: { items: [{ uri: 'spotify:artist:target-v2', profile: { name: '日向坂46' } }] },
    tracks: {
      items: [{ track: { uri: 'spotify:track:track-v2', name: 'Track', playcount: '42' } }],
    },
  }, [{ artist_key: 'hinatazaka46', spotify_artist_id: 'target-v2' }]);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].track_id, 'track-v2');
  assert.equal(tracks[0].playcount, 42);
  assert.deepEqual(tracks[0].target_keys, ['hinatazaka46']);
});

test('collector is pinned to the live-tested anonymous Pathfinder operations', () => {
  const source = readFileSync(new URL('../src/spotify-playcount-source.js', import.meta.url), 'utf8');
  assert.match(source, /api-partner\.spotify\.com\/pathfinder\/v1\/query/);
  assert.match(source, /queryArtistDiscographyAll/);
  assert.match(source, /9380995a9d4663cbcb5113fef3c6aabf70ae6d407ba61793fd01e2a1dd6929b0/);
  assert.match(source, /queryAlbumTracks/);
  assert.match(source, /3ea563e1d68f486d8df30f69de9dcedae74c77e684b889ba7408c589d30f7f2e/);
  assert.doesNotMatch(source, /api\.spotify\.com\/v1/);
});

test('advance detection ignores new tracks and requires an existing track to increase', () => {
  const previous = [
    { track_id: 'a', playcount: 100 },
    { track_id: 'b', playcount: 200 },
  ];
  assert.equal(hasPlaycountAdvance(previous, [
    { track_id: 'a', playcount: 100 },
    { track_id: 'b', playcount: 200 },
    { track_id: 'new', playcount: 999 },
  ]), false);
  assert.equal(hasPlaycountAdvance(previous, [
    { track_id: 'a', playcount: 101 },
    { track_id: 'b', playcount: 200 },
  ]), true);
});

test('regression detection rejects cumulative counters that move backwards', () => {
  const previous = [
    { track_id: 'a', playcount: 100 },
    { track_id: 'b', playcount: 200 },
  ];
  assert.equal(countPlaycountRegressions(previous, [
    { track_id: 'a', playcount: 100 },
    { track_id: 'b', playcount: 199 },
  ]), 1);
  assert.equal(countPlaycountRegressions(previous, [
    { track_id: 'a', playcount: 101 },
    { track_id: 'b', playcount: 200 },
  ]), 0);
});

test('staging and finalization are guarded against late or duplicate queue deliveries', () => {
  const common = readFileSync(new URL('../src/spotify-playcount-common.js', import.meta.url), 'utf8');
  const consumer = readFileSync(new URL('../src/spotify-playcount-consumer.js', import.meta.url), 'utf8');
  const schedule = readFileSync(new URL('../src/spotify-playcount-schedule.js', import.meta.url), 'utf8');
  assert.match(common, /\['catalog', 'queued'\]\.includes/);
  assert.match(consumer, /MAX\(sh_spotify_playcount_candidates\.playcount,excluded\.playcount\)/);
  assert.match(consumer, /status='finalizing'/);
  assert.match(consumer, /DELETE FROM sh_spotify_playcount_candidates/);
  assert.match(consumer, /DELETE FROM sh_spotify_collection_album_runs/);
  assert.match(consumer, /SET is_active=0/);
  assert.match(schedule, /Number\(existing\.errors \|\| 0\) > 0/);
  assert.match(schedule, /\['error', 'incomplete'\]\.includes/);
});

test('stale and incomplete runs are retryable while fresh queued work is not duplicated', () => {
  const now = Date.UTC(2026, 8, 27, 0, 0, 0);
  assert.equal(shouldRetryRun({ status: 'stale', updated_at: now - 1 }), true);
  assert.equal(shouldRetryRun({ status: 'incomplete', updated_at: now - 1 }), true);
  assert.equal(shouldRetryRun({ status: 'queued', updated_at: now - 10 * 60 * 1000 }, now), false);
  assert.equal(shouldRetryRun({ status: 'queued', updated_at: now - 60 * 60 * 1000 }, now), true);
  assert.equal(shouldRetryRun({ status: 'finalizing', updated_at: now - 60 * 60 * 1000 }, now), true);
  assert.equal(shouldRetryRun({ status: 'complete', updated_at: now - 60 * 60 * 1000 }, now), false);
});
