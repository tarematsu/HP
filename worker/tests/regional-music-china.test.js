import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseQqSingerId,
  parseQqSingerTracks,
} from '../src/regional-music-qq.js';
import {
  parseNeteaseAlbumTracks,
  parseNeteaseAlbums,
  parseNeteaseArtistId,
  parseNeteaseCommentCount,
  parseNeteaseHotTracks,
} from '../src/regional-music-netease.js';
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

test('NetEase requires an exact artist identity and keeps only that artist tracks', () => {
  const search = {
    result: {
      artists: [
        { id: 1, name: 'Nogizaka46 cover', musicSize: 999 },
        { id: 2, name: 'Nogizaka46', musicSize: 20 },
        { id: 3, name: '乃木坂46', musicSize: 30 },
      ],
    },
  };
  assert.equal(parseNeteaseArtistId(search, NOGI_ALIASES), '3');

  const hot = {
    hotSongs: [
      { id: 11, name: 'A', ar: [{ id: 3, name: '乃木坂46' }], al: { name: 'X' } },
      { id: 12, name: 'Fake', ar: [{ id: 99, name: 'Other' }], al: { name: 'Y' } },
      { id: 13, name: 'B', artists: [{ id: 3, name: '乃木坂46' }], album: { name: 'Z' } },
    ],
  };
  assert.deepEqual(parseNeteaseHotTracks(hot, '3', NOGI_ALIASES), [
    { track_id: '11', title: 'A', album_name: 'X', rank: 1 },
    { track_id: '13', title: 'B', album_name: 'Z', rank: 3 },
  ]);
  assert.equal(parseNeteaseCommentCount({ total: 12345 }), 12345);
});

test('NetEase album rotation inputs retain album and track identities', () => {
  assert.deepEqual(parseNeteaseAlbums({ hotAlbums: [{ id: 91, name: 'Album 1' }, { id: 92, name: 'Album 2' }] }), [
    { id: '91', name: 'Album 1' },
    { id: '92', name: 'Album 2' },
  ]);
  assert.deepEqual(parseNeteaseAlbumTracks({
    songs: [
      { id: 100, name: 'Song', artists: [{ id: 3, name: '乃木坂46' }], album: { name: 'Album 1' } },
      { id: 101, name: 'Other', artists: [{ id: 4, name: 'Other' }], album: { name: 'Album 1' } },
    ],
  }, '3', NOGI_ALIASES), [
    { track_id: '100', title: 'Song', album_name: 'Album 1', rank: null },
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
