import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseQqSingerId,
  parseQqSingerTracks,
} from '../src/regional-music-qq.js';
import { parseKugouSearchTracks } from '../src/regional-music-kugou.js';

const NOGI_ALIASES = ['乃木坂46', 'Nogizaka46', 'NOGIZAKA46'];

test('QQ Music resolves an exact singer and listen-ordered tracks', () => {
  const search = {
    data: {
      singer: {
        itemlist: [
          { mid: 'wrong', name: 'Nogizaka' },
          { mid: 'n46mid', name: 'Nogizaka46' },
        ],
      },
    },
  };
  assert.equal(parseQqSingerId(search, NOGI_ALIASES), 'n46mid');

  const payload = {
    data: {
      list: [
        { musicData: { songmid: 'song1', songname: 'A', albumname: 'Album A', singer: [{ mid: 'n46mid', name: 'Nogizaka46' }] } },
        { musicData: { songmid: 'song2', songname: 'B', albumname: 'Album B', singer: [{ mid: 'other', name: 'Other' }] } },
        { musicData: { songmid: 'song3', songname: 'C', albumname: 'Album C', singer: [{ mid: 'n46mid', name: 'Nogizaka46' }] } },
      ],
    },
  };
  assert.deepEqual(parseQqSingerTracks(payload, 'n46mid', NOGI_ALIASES), [
    { track_id: 'song1', title: 'A', album_name: 'Album A', rank: 1 },
    { track_id: 'song3', title: 'C', album_name: 'Album C', rank: 3 },
  ]);
});

test('Kugou filters artist search results and preserves stable ids', () => {
  const payload = {
    data: {
      info: [
        {
          album_audio_id: 123,
          hash: 'abcdef',
          songname: 'Track A',
          singername: 'Nogizaka46',
          album_name: 'Album A',
          author_id: 456,
        },
        {
          album_audio_id: 124,
          hash: 'fedcba',
          songname: 'Wrong',
          singername: 'Other',
          album_name: 'Album B',
          author_id: 999,
        },
      ],
    },
  };
  assert.deepEqual(parseKugouSearchTracks(payload, NOGI_ALIASES), [
    {
      track_id: '123',
      title: 'Track A',
      album_name: 'Album A',
      author_id: '456',
      hash: 'abcdef',
    },
  ]);
});
