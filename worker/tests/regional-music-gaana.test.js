import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseGaanaArtist,
  parseGaanaTopTracks,
} from '../src/regional-music-gaana.js';

const SAKURA = ['櫻坂46', 'Sakurazaka46', 'SAKURAZAKA46'];

test('Gaana resolves exact artist results', () => {
  const payload = {
    gr: [{ gd: [
      { id: '1', seo: 'wrong', ti: 'Sakurazaka cover' },
      { id: '46', seo: 'sakurazaka46', ti: 'Sakurazaka46' },
    ] }],
  };
  assert.deepEqual(parseGaanaArtist(payload, SAKURA), {
    id: '46',
    seokey: 'sakurazaka46',
    name: 'Sakurazaka46',
  });
});

test('Gaana top tracks keep exact artist membership and popularity rank', () => {
  const payload = {
    entities: [
      {
        entity_id: '101',
        seokey: 'track-a',
        name: 'Track A',
        entity_info: [
          { key: 'artist', value: [{ artist_id: '46', name: 'Sakurazaka46' }] },
          { key: 'album', value: [{ album_id: '9', name: 'Album A', album_seokey: 'album-a' }] },
        ],
      },
      {
        entity_id: '102',
        seokey: 'wrong',
        name: 'Wrong',
        entity_info: [{ key: 'artist', value: [{ artist_id: '99', name: 'Other' }] }],
      },
      {
        entity_id: '103',
        seokey: 'track-b',
        name: 'Track B',
        entity_info: [{ key: 'artist', value: [{ artist_id: '46', name: '櫻坂46' }] }],
      },
    ],
  };
  assert.deepEqual(parseGaanaTopTracks(payload, SAKURA, '46'), [
    { track_id: '101', title: 'Track A', album_name: 'Album A', seokey: 'track-a', popularity_rank: 1 },
    { track_id: '103', title: 'Track B', album_name: null, seokey: 'track-b', popularity_rank: 3 },
  ]);
});
