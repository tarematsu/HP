import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAmazonMusicWebClient,
  extractAmazonMusicTracks,
  extractFollowerCount,
  extractIsrc,
  extractNextToken,
  resetAmazonMusicConfigCache,
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

test('Web client follows the current Web Player bootstrap, catalog host, and popular-songs pagination', async () => {
  resetAmazonMusicConfigCache();
  const calls = [];
  const jsonResponse = (value) => ({ ok: true, status: 200, json: async () => value });
  const next = JSON.stringify({ offset: 20, nextToken: 'token-2', count: 20 });
  const firstTracks = {
    methods: [{ template: {
      items: [{
        primaryText: { text: '1. Song A' },
        secondaryText: '櫻坂46',
        iconButton: { observer: { storageKey: 'ALBUM1:TRACKA' } },
      }],
      onCreated: [{
        url: `https://fe.mesk.skill.music.a2z.com/api/showCatalogTracks?id=${encodeURIComponent('uri://artist/B08P3RHP1P/popular-songs')}&next=${encodeURIComponent(next)}&userHash=${encodeURIComponent(JSON.stringify({ level: 'LIBRARY_MEMBER' }))}`,
      }],
    } }],
  };
  const secondTracks = {
    methods: [{ template: {
      items: [{
        primaryText: { text: '2. Song B' },
        secondaryText: '櫻坂46',
        iconButton: { observer: { storageKey: 'ALBUM2:TRACKB' } },
      }],
    } }],
  };
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/config.json?')) {
      return jsonResponse({
        deviceId: 'device',
        sessionId: 'session',
        version: '1.0.11376.0',
        csrf: { token: 'csrf', ts: 123, rnd: 456 },
      });
    }
    if (String(url).endsWith('/api/showHome')) return jsonResponse({ methods: [] });
    if (String(url).endsWith('/api/showCatalogTracks')) {
      const body = JSON.parse(init.body);
      return jsonResponse(body.next ? secondTracks : firstTracks);
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const tracks = await createAmazonMusicWebClient(fetchImpl).fetchArtistTracks('B08P3RHP1P');
  assert.deepEqual(tracks.map((track) => track.amazon_music_id), ['TRACKA', 'TRACKB']);

  const configCall = calls.find((call) => call.url.includes('/config.json?'));
  assert.equal(configCall.init.method, 'POST');
  assert.match(configCall.url, /skipToken=false&clientApplication=skyfire/);

  const homeIndex = calls.findIndex((call) => call.url.endsWith('/api/showHome'));
  const catalogCalls = calls.filter((call) => call.url.endsWith('/api/showCatalogTracks'));
  assert.ok(homeIndex >= 0);
  assert.equal(catalogCalls.length, 2);
  assert.match(catalogCalls[0].url, /^https:\/\/fe\.mesk\.skill\.music\.a2z\.com\//);
  const firstBody = JSON.parse(catalogCalls[0].init.body);
  assert.equal(firstBody.id, 'uri://artist/B08P3RHP1P/popular-songs');
  const innerHeaders = JSON.parse(firstBody.headers);
  assert.equal(innerHeaders['x-amzn-device-time-zone'], 'UTC');
  assert.equal(innerHeaders['x-amzn-referer'], '');
  assert.match(innerHeaders['x-amzn-user-agent'], /Chrome\/140/);
  const secondBody = JSON.parse(catalogCalls[1].init.body);
  assert.equal(secondBody.next, next);
  resetAmazonMusicConfigCache();
});
