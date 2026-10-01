import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseJioSaavnArtist,
  parseJioSaavnTracks,
} from '../src/regional-music-jiosaavn.js';

const NOGI = ['乃木坂46', 'Nogizaka46', 'NOGIZAKA46'];

test('JioSaavn autocomplete requires an exact artist alias', () => {
  const payload = {
    artists: {
      data: [
        { id: 'wrong', title: 'Nogizaka cover' },
        { id: 'n46', title: 'Nogizaka46', url: 'https://www.jiosaavn.com/artist/nogizaka46-songs/n46' },
      ],
    },
  };
  assert.deepEqual(parseJioSaavnArtist(payload, NOGI), {
    id: 'n46',
    name: 'Nogizaka46',
    url: 'https://www.jiosaavn.com/artist/nogizaka46-songs/n46',
  });
});

test('JioSaavn track search filters unrelated artists and keeps service ids', () => {
  const payload = {
    results: [
      { id: 's1', title: 'Track A', album: 'Album A', primary_artists: 'Nogizaka46', primary_artists_id: 'n46', perma_url: 'https://www.jiosaavn.com/song/a' },
      { id: 's2', title: 'Wrong', album: 'Album B', primary_artists: 'Other', primary_artists_id: 'x' },
      { id: 's3', title: 'Track B', album: { name: 'Album C' }, primary_artists: 'Other', primary_artists_id: 'n46' },
    ],
  };
  assert.deepEqual(parseJioSaavnTracks(payload, NOGI, 'n46'), [
    { track_id: 's1', title: 'Track A', album_name: 'Album A', url: 'https://www.jiosaavn.com/song/a' },
    { track_id: 's3', title: 'Track B', album_name: 'Album C', url: null },
  ]);
});
