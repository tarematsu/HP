import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLE_MUSIC_ARTIST_ID,
  APPLE_MUSIC_PAGES_MODEL_KEY,
  APPLE_MUSIC_REGIONS,
  appleMusicBundleUrls,
  appleMusicTopSongsUrl,
  buildAppleMusicReadModel,
  collectAppleMusicSnapshot,
  extractAppleMusicWebToken,
  normalizeAppleMusicTopSongs,
} from '../src/apple-music-collector.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

class FakeR2 {
  constructor() {
    this.values = new Map();
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }

  async get(key) {
    const value = this.values.get(key);
    if (value == null) return null;
    return {
      async json() { return JSON.parse(value); },
      async text() { return value; },
    };
  }
}

function topSongsPayload(country) {
  return {
    data: [
      {
        id: `${country}01`,
        type: 'songs',
        attributes: {
          name: `${country.toUpperCase()} Song A`,
          albumName: `${country.toUpperCase()} Album`,
          artistName: '櫻坂46',
          artwork: { url: `https://example.test/${country}/{w}x{h}.jpg` },
          url: `https://music.apple.com/${country}/song/a`,
          releaseDate: '2026-09-01',
          isrc: `JPAAA26${country.toUpperCase()}01`,
        },
      },
      {
        id: `${country}02`,
        type: 'songs',
        attributes: {
          name: `${country.toUpperCase()} Song B`,
          albumName: `${country.toUpperCase()} Album`,
          artistName: '櫻坂46',
          artwork: { url: `https://example.test/${country}/{w}x{h}.jpg` },
          url: `https://music.apple.com/${country}/song/b`,
          releaseDate: '2026-08-01',
        },
      },
    ],
  };
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function fakeWebToken(now) {
  return `${base64url({ alg: 'ES256', typ: 'JWT' })}.${base64url({ exp: Math.floor(now / 1000) + 3600, iss: 'apple-web' })}.${'x'.repeat(48)}`;
}

test('Apple Music URL selects the regional top-songs view', () => {
  const top = new URL(appleMusicTopSongsUrl('tw', 12));
  assert.equal(top.origin, 'https://api.music.apple.com');
  assert.equal(top.pathname, `/v1/catalog/tw/artists/${APPLE_MUSIC_ARTIST_ID}/view/top-songs`);
  assert.equal(top.searchParams.get('limit'), '12');
});

test('Apple Music web bootstrap finds the index bundle and a non-expired token', () => {
  const html = '<script src="/assets/chunk.js"></script><script src="/assets/index-abcd.js"></script>';
  assert.deepEqual(appleMusicBundleUrls(html).map((value) => new URL(value).pathname), [
    '/assets/index-abcd.js',
    '/assets/chunk.js',
  ]);
  const now = Date.UTC(2026, 8, 30, 2, 0, 0);
  const token = fakeWebToken(now);
  assert.equal(extractAppleMusicWebToken(`const token="${token}";`, now), token);
  assert.equal(extractAppleMusicWebToken(`const token="${token}";`, now + 2 * 60 * 60_000), null);
});

test('Apple Music top-songs normalization preserves page order and deduplicates by song title', () => {
  const payload = topSongsPayload('jp');
  payload.data.push({
    id: 'jp99',
    attributes: { name: 'ＪＰ Song A', artistName: '櫻坂46' },
  });
  const tracks = normalizeAppleMusicTopSongs(payload);
  assert.deepEqual(tracks.map(({ rank, title }) => ({ rank, title })), [
    { rank: 1, title: 'JP Song A' },
    { rank: 2, title: 'JP Song B' },
  ]);
  assert.equal(tracks[0].track_id, 'jp01');
  assert.equal(tracks[0].song_key, 'jpsonga');
  assert.match(tracks[0].artwork, /300x300/);
});

test('Apple Music read model replaces same-day history and bounds regional history payload', () => {
  const snapshot = {
    version: 1,
    source: 'apple-music-web-top-songs',
    artist_id: APPLE_MUSIC_ARTIST_ID,
    snapshot_date: '2026-09-30',
    observed_at: 123,
    failed_regions: [],
    regions: [{
      code: 'jp',
      label: '日本',
      tracks: Array.from({ length: 20 }, (_, index) => ({
        rank: index + 1,
        song_key: `song${index + 1}`,
        track_id: String(5000 + index),
        title: `Song ${index + 1}`,
      })),
    }],
  };
  const model = buildAppleMusicReadModel(snapshot, {
    history: [
      { snapshot_date: '2026-09-29', observed_at: 1, regions: {} },
      { snapshot_date: '2026-09-30', observed_at: 2, regions: {} },
    ],
  });
  assert.deepEqual(model.history.map((point) => point.snapshot_date), ['2026-09-29', '2026-09-30']);
  assert.equal(model.history.at(-1).regions.jp.length, 12);
  assert.equal(model.history.at(-1).regions.jp[0].song_key, 'song1');
});

test('Apple Music collector uses regional web top-songs and publishes the read model', async () => {
  const r2 = new FakeR2();
  const now = Date.UTC(2026, 8, 30, 2, 0, 0);
  const token = fakeWebToken(now);
  const fakeFetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'music.apple.com' && url.pathname === '/us/browse') {
      return new Response('<script src="/assets/index-test.js"></script>', { status: 200 });
    }
    if (url.hostname === 'music.apple.com' && url.pathname === '/assets/index-test.js') {
      return new Response(`window.__token="${token}";`, { status: 200 });
    }
    if (url.hostname === 'api.music.apple.com') {
      const country = url.pathname.split('/')[3];
      if (country === 'kr') return new Response('{}', { status: 503 });
      return new Response(JSON.stringify(topSongsPayload(country)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const result = await collectAppleMusicSnapshot({ PAGES_RESPONSE_R2: r2 }, now, fakeFetch);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot_date, '2026-09-30');
  assert.equal(result.source, 'apple-music-web-top-songs');
  assert.equal(result.regions, APPLE_MUSIC_REGIONS.length - 1);
  assert.deepEqual(result.failed_regions, ['kr']);

  const prefix = `apple-music/artist/${APPLE_MUSIC_ARTIST_ID}/`;
  assert.ok(r2.values.has(`${prefix}daily/2026-09-30.json`));
  assert.ok(r2.values.has(`${prefix}latest.json`));
  assert.ok(r2.values.has('apple-music/read-model/latest.json'));

  const publicKey = pagesActionsR2ResponseKey(APPLE_MUSIC_PAGES_MODEL_KEY);
  assert.ok(r2.values.has(publicKey));
  const envelope = JSON.parse(r2.values.get(publicKey));
  const payload = JSON.parse(envelope.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.regions.length, APPLE_MUSIC_REGIONS.length - 1);
  assert.equal(payload.regions[0].source, 'apple-music-web-top-songs');
  assert.equal(payload.failed_regions[0].code, 'kr');
});
