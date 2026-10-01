import assert from 'node:assert/strict';
import test from 'node:test';

import { parseYandexTracks } from '../src/regional-music-yandex.js';

const HINATA = ['日向坂46', 'Hinatazaka46', 'HINATAZAKA46'];

test('Yandex keeps only exact artist tracks and preserves artist/album ids', () => {
  const payload = {
    tracks: {
      items: [
        {
          id: '101',
          type: 'music',
          title: 'Track A',
          artists: [{ id: '7101843', name: 'Hinatazaka46' }],
          albums: [{ id: '501', title: 'Album A' }],
        },
        {
          id: '102',
          type: 'music',
          title: 'Wrong',
          artists: [{ id: '99', name: 'Other' }],
          albums: [{ id: '502', title: 'Other Album' }],
        },
      ],
    },
  };
  assert.deepEqual(parseYandexTracks(payload, HINATA), [
    {
      track_id: '101',
      title: 'Track A',
      album_id: '501',
      album_name: 'Album A',
      artist_id: '7101843',
    },
  ]);
});
