import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseVibeArtist,
  parseVibeArtistDetail,
  parseVibeTracks,
} from '../src/regional-music-vibe.js';

const HINATA = ['日向坂46', 'Hinatazaka46', 'HINATAZAKA46'];

test('VIBE artist search requires an exact alias', () => {
  const payload = { response: { result: { artists: [
    { artistId: 1, artistName: 'Hinatazaka cover', likeCount: 999 },
    { artistId: 2834287, artistName: 'Hinatazaka46', likeCount: 42 },
  ] } } };
  assert.deepEqual(parseVibeArtist(payload, HINATA), {
    id: '2834287',
    name: 'Hinatazaka46',
    likes: 42,
  });
});

test('VIBE artist detail verifies both id and name', () => {
  const payload = { response: { result: { artist: {
    artistId: 2834287,
    artistName: '日向坂46',
    likeCount: 1234,
  } } } };
  assert.deepEqual(parseVibeArtistDetail(payload, '2834287', HINATA), {
    id: '2834287',
    name: '日向坂46',
    likes: 1234,
  });
  assert.equal(parseVibeArtistDetail(payload, '999', HINATA), null);
});

test('VIBE release tracks keep only the target artist', () => {
  const payload = { response: { result: { tracks: [
    {
      trackId: 11,
      trackTitle: 'Track A',
      likeCount: 7,
      artists: [{ artistId: 2834287, artistName: 'Hinatazaka46' }],
      album: { albumTitle: 'Album A' },
    },
    {
      trackId: 12,
      trackTitle: 'Wrong',
      artists: [{ artistId: 9, artistName: 'Other' }],
      album: { albumTitle: 'Album B' },
    },
  ] } } };
  assert.deepEqual(parseVibeTracks(payload, '2834287', HINATA), [
    { track_id: '11', title: 'Track A', album_name: 'Album A', likes: 7 },
  ]);
});
