import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchTrackMetadata } from '../src/track-metadata.js';

async function withFetch(fetchImpl, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try { return await callback(); } finally { globalThis.fetch = originalFetch; }
}

test('track metadata falls back to the public Spotify track page when oEmbed fails', async () => {
  const urls = [];
  await withFetch(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/oembed?')) return new Response('blocked', { status: 403 });
    assert.equal(url, 'https://open.spotify.com/track/spotify-fallback-1');
    return new Response(`<!doctype html><html><head>
      <title>どうする？どうする？どうする？ - song and lyrics by Hinatazaka46 | Spotify</title>
      <meta property="og:image" content="https://i.scdn.co/image/fallback-cover">
    </head></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
  }, async () => {
    const value = await fetchTrackMetadata({
      spotify_id: 'spotify-fallback-1',
      isrc: 'jpu902101035',
    }, { requestTimeoutMs: 1000, collectionSignal: null });
    assert.equal(value.title, 'どうする？どうする？どうする？');
    assert.equal(value.artist, 'Hinatazaka46');
    assert.equal(value.isrc, 'JPU902101035');
    assert.equal(value.thumbnail_url, 'https://i.scdn.co/image/fallback-cover');
    assert.equal(value.source, 'spotify_oembed');
    assert.deepEqual(value.raw.spotify, null);
    assert.match(value.raw.spotify_page.title, /Hinatazaka46/);
    assert.equal(urls.length, 2);
  });
});

test('track metadata falls back when oEmbed has a title but no artist', async () => {
  const urls = [];
  await withFetch(async (input) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/oembed?')) {
      return Response.json({
        title: '自称バレエダンサー',
        thumbnail_url: 'https://i.scdn.co/image/oembed-cover',
      });
    }
    assert.equal(url, 'https://open.spotify.com/track/spotify-new-release');
    return new Response(`<!doctype html><html><head>
      <title>自称バレエダンサー - song and lyrics by 櫻坂46 | Spotify</title>
      <meta property="og:image" content="https://i.scdn.co/image/page-cover">
    </head></html>`, { status: 200 });
  }, async () => {
    const value = await fetchTrackMetadata({ spotify_id: 'spotify-new-release' }, {
      requestTimeoutMs: 1000,
      collectionSignal: null,
    });
    assert.equal(value.title, '自称バレエダンサー');
    assert.equal(value.artist, '櫻坂46');
    assert.equal(value.thumbnail_url, 'https://i.scdn.co/image/oembed-cover');
    assert.equal(value.raw.spotify.title, '自称バレエダンサー');
    assert.match(value.raw.spotify_page.title, /櫻坂46/);
    assert.equal(urls.length, 2);
  });
});

test('Spotify page fallback decodes HTML entities in title and artist', async () => {
  await withFetch(async (input) => {
    const url = String(input);
    if (url.includes('/oembed?')) return new Response('', { status: 429 });
    return new Response('<title>A &amp; B - song and lyrics by Hinatazaka46 &amp; Friends | Spotify</title>', { status: 200 });
  }, async () => {
    const value = await fetchTrackMetadata({ spotify_id: 'spotify-fallback-2' }, {
      requestTimeoutMs: 1000,
      collectionSignal: null,
    });
    assert.equal(value.title, 'A & B');
    assert.equal(value.artist, 'Hinatazaka46 & Friends');
  });
});

test('Spotify page fallback refuses pages without an artist identity', async () => {
  await withFetch(async (input) => {
    const url = String(input);
    if (url.includes('/oembed?')) return new Response('', { status: 503 });
    return new Response('<title>Spotify - Web Player</title>', { status: 200 });
  }, async () => {
    const value = await fetchTrackMetadata({ spotify_id: 'spotify-fallback-3' }, {
      requestTimeoutMs: 1000,
      collectionSignal: null,
    });
    assert.equal(value, null);
  });
});
