import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseFloAlbumTracks,
  parseFloAlbums,
  parseFloArtistId,
} from '../src/regional-music-flo.js';

const SAKURA = ['櫻坂46', 'Sakurazaka46', 'SAKURAZAKA46'];

test('FLO resolves exact artist identity from typed search groups', () => {
  const payload = {
    data: {
      list: [
        { type: 'ARTIST', list: [
          { id: 1, name: 'Sakurazaka cover' },
          { id: 2, name: 'Sakurazaka46' },
        ] },
      ],
    },
  };
  assert.equal(parseFloArtistId(payload, SAKURA), '2');
});

test('FLO filters albums by exact artist aliases', () => {
  const payload = {
    data: {
      list: [
        { type: 'ALBUM', list: [
          { id: 11, title: 'Album A', artistList: [{ name: '櫻坂46' }] },
          { id: 12, title: 'Wrong', artistList: [{ name: 'Other' }] },
        ] },
      ],
    },
  };
  assert.deepEqual(parseFloAlbums(payload, SAKURA), [
    { id: '11', title: 'Album A' },
  ]);
});

test('FLO album track parser preserves service ids and metadata', () => {
  const payload = {
    data: {
      list: [
        { id: 101, name: 'Track A', artistList: [{ name: 'SAKURAZAKA46' }], album: { title: 'Album A' } },
        { id: 102, name: 'Wrong', artistList: [{ name: 'Other' }], album: { title: 'Album A' } },
      ],
    },
  };
  assert.deepEqual(parseFloAlbumTracks(payload, SAKURA), [
    { track_id: '101', title: 'Track A', album_name: 'Album A' },
  ]);
});
