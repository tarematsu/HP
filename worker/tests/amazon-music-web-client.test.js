import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractAmazonMusicTracks,
  extractFollowerCount,
  extractIsrc,
  extractNextToken,
} from '../src/amazon-music-web-client.js';

test('Amazon Music extractor preserves response order as popularity order', () => {
  const payload = {
    methods: [{
      template: {
        followerCount: 53124,
        widgets: [{
          header: 'Top Songs',
          items: [
            {
              primaryText: { text: '1. Song A' },
              secondaryText: '櫻坂46',
              iconButton: { observer: { storageKey: 'ALBUM1:TRACKA' } },
            },
            {
              primaryText: { text: '2. Song B' },
              secondaryText: '櫻坂46',
              primaryTextLink: { deeplink: '/tracks/TRACKB/song-b' },
            },
          ],
        }],
      },
    }],
  };
  const tracks = extractAmazonMusicTracks(payload);
  assert.deepEqual(tracks.map((track) => track.amazon_music_id), ['TRACKA', 'TRACKB']);
  assert.deepEqual(tracks.map((track) => track.title), ['Song A', 'Song B']);
  assert.equal(extractFollowerCount(payload).count, 53124);
  assert.equal(extractFollowerCount(payload).exact, true);
});

test('follower label is retained as an approximate count when exact field is absent', () => {
  const value = extractFollowerCount('<span>53千人以上のフォロワー</span>');
  assert.equal(value.count, 53000);
  assert.equal(value.exact, false);
  assert.match(value.label, /53千/);
});

test('track details expose ISRC and pagination token defensively', () => {
  const payload = {
    methods: [{
      template: {
        widgets: [{ items: [{ metadata: { isrc: 'jpabc2600001' } }] }],
        pagination: { nextPageToken: 'next-token-1234567890' },
      },
    }],
  };
  assert.equal(extractIsrc(payload), 'JPABC2600001');
  assert.equal(extractNextToken(payload), 'next-token-1234567890');
});

test('embedded application/json is usable for public popular ranking fallback', () => {
  const html = `<html><script type="application/json">${JSON.stringify({
    items: [{
      type: 'track',
      id: 'POPULAR1',
      title: 'Popular Song',
      artist: '櫻坂46',
    }],
  })}</script></html>`;
  assert.deepEqual(extractAmazonMusicTracks(html), [{
    amazon_music_id: 'POPULAR1',
    title: 'Popular Song',
    artist: '櫻坂46',
    album: null,
    image: null,
    isrc: null,
  }]);
});
