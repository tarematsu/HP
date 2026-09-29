import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APPLE_MUSIC_ARTIST_ID,
  APPLE_MUSIC_PAGES_MODEL_KEY,
  APPLE_MUSIC_REGIONS,
  appleMusicLookupUrl,
  buildAppleMusicReadModel,
  collectAppleMusicSnapshot,
  normalizeAppleMusicLookup,
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

function lookupPayload(country) {
  const offset = APPLE_MUSIC_REGIONS.findIndex((region) => region.code === country) + 1;
  return {
    resultCount: 4,
    results: [
      { wrapperType: 'artist', artistId: Number(APPLE_MUSIC_ARTIST_ID), artistName: '櫻坂46' },
      {
        wrapperType: 'track',
        trackId: 1000 + offset * 10 + 1,
        trackName: `${country.toUpperCase()} Song A`,
        collectionName: `${country.toUpperCase()} Album`,
        artistName: '櫻坂46',
        artworkUrl100: `https://example.test/${country}/a.jpg`,
        trackViewUrl: `https://music.apple.com/${country}/song/a`,
        releaseDate: '2026-09-01T00:00:00Z',
      },
      {
        wrapperType: 'track',
        trackId: 1000 + offset * 10 + 2,
        trackName: `${country.toUpperCase()} Song B`,
        collectionName: `${country.toUpperCase()} Album`,
        artistName: '櫻坂46',
        artworkUrl100: `https://example.test/${country}/b.jpg`,
        trackViewUrl: `https://music.apple.com/${country}/song/b`,
        releaseDate: '2026-08-01T00:00:00Z',
      },
      {
        wrapperType: 'track',
        trackId: 1000 + offset * 10 + 1,
        trackName: 'duplicate',
        artistName: '櫻坂46',
      },
    ],
  };
}

test('Apple Music lookup URL requests unauthenticated regional popular songs', () => {
  const url = new URL(appleMusicLookupUrl('tw', 12));
  assert.equal(url.origin, 'https://itunes.apple.com');
  assert.equal(url.pathname, '/lookup');
  assert.equal(url.searchParams.get('id'), APPLE_MUSIC_ARTIST_ID);
  assert.equal(url.searchParams.get('entity'), 'song');
  assert.equal(url.searchParams.get('sort'), 'popular');
  assert.equal(url.searchParams.get('limit'), '12');
  assert.equal(url.searchParams.get('country'), 'tw');
});

test('Apple Music lookup normalization preserves popularity order and deduplicates tracks', () => {
  const tracks = normalizeAppleMusicLookup(lookupPayload('jp'));
  assert.deepEqual(tracks.map(({ rank, title }) => ({ rank, title })), [
    { rank: 1, title: 'JP Song A' },
    { rank: 2, title: 'JP Song B' },
  ]);
  assert.equal(tracks[0].track_id, 1011);
  assert.equal(tracks[0].artist, '櫻坂46');
});

test('Apple Music read model replaces same-day history and bounds regional history payload', () => {
  const snapshot = {
    version: 1,
    source: 'itunes-lookup-sort-popular',
    artist_id: APPLE_MUSIC_ARTIST_ID,
    snapshot_date: '2026-09-30',
    observed_at: 123,
    failed_regions: [],
    regions: [{
      code: 'jp',
      label: '日本',
      tracks: Array.from({ length: 20 }, (_, index) => ({
        rank: index + 1,
        track_id: 5000 + index,
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
  assert.equal(model.history.at(-1).regions.jp[0].track_id, 5000);
});

test('Apple Music collector tolerates one failed region and publishes the read model', async () => {
  const r2 = new FakeR2();
  const fakeFetch = async (input) => {
    const url = new URL(input);
    const country = url.searchParams.get('country');
    if (country === 'kr') return new Response('{}', { status: 503 });
    return new Response(JSON.stringify(lookupPayload(country)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const now = Date.UTC(2026, 8, 30, 2, 0, 0);
  const result = await collectAppleMusicSnapshot({ PAGES_RESPONSE_R2: r2 }, now, fakeFetch);

  assert.equal(result.ok, true);
  assert.equal(result.snapshot_date, '2026-09-30');
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
  assert.equal(payload.failed_regions[0].code, 'kr');
});
