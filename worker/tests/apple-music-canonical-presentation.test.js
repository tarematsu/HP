import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeAppleMusicPresentation } from '../src/apple-music-canonical-presentation.js';
import { APPLE_MUSIC_PAGES_MODEL_KEY } from '../src/apple-music-collector.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';

const READ_MODEL_KEY = 'apple-music/read-model/latest.json';

class FakeR2 {
  constructor(entries = []) {
    this.values = new Map(entries);
    this.putCount = 0;
  }

  async get(key) {
    const value = this.values.get(key);
    if (value == null) return null;
    return {
      async json() { return JSON.parse(value); },
      async text() { return value; },
    };
  }

  async put(key, value) {
    this.putCount += 1;
    this.values.set(key, String(value));
  }
}

class FakeD1 {
  constructor(rows) {
    this.rows = rows;
    this.reads = 0;
  }

  prepare(sql) {
    const database = this;
    return {
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async all() {
        database.reads += 1;
        if (!sql.includes('FROM sh_track_canonical_metadata')) {
          throw new Error(`unexpected SQL: ${sql}`);
        }
        const ids = new Set(this.args.map((value) => Number(value)));
        return {
          results: database.rows
            .filter((row) => ids.has(Number(row.track_id)))
            .map((row) => ({ ...row })),
        };
      },
    };
  }

  async batch() {}
}

test('Apple Music presentation uses canonical Japanese titles without changing ranking identity', async () => {
  const observedAt = Date.UTC(2026, 9, 1, 2, 15, 0);
  const model = {
    version: 2,
    source: 'apple-music-web-top-songs',
    artist_id: '1541126420',
    artist_name: '櫻坂46',
    snapshot_date: '2026-10-01',
    observed_at: observedAt - 60_000,
    regions: [{
      code: 'jp',
      label: '日本',
      tracks: [
        {
          rank: 1,
          track_id: 101,
          apple_music_id: 'apple-101',
          isrc: 'JPAAA2600101',
          song_key: 'samidareyo',
          title: 'Samidareyo',
          artist: '櫻坂46',
          artwork: 'https://example.test/101.jpg',
        },
        {
          rank: 2,
          track_id: 102,
          apple_music_id: 'apple-102',
          isrc: 'JPAAA2600102',
          song_key: 'startover!',
          title: 'Start over!',
          artist: '櫻坂46',
          artwork: 'https://example.test/102.jpg',
        },
      ],
    }],
    history: [],
  };
  const r2 = new FakeR2([[READ_MODEL_KEY, JSON.stringify(model)]]);
  const db = new FakeD1([
    {
      track_id: 101,
      stationhead_track_id: null,
      isrc: 'JPAAA2600101',
      spotify_id: 'spotify-101',
      title: '五月雨よ',
      artist: '櫻坂46',
      thumbnail_url: 'https://example.test/canonical-101.jpg',
    },
    {
      track_id: 102,
      stationhead_track_id: null,
      isrc: 'JPAAA2600102',
      spotify_id: 'spotify-102',
      title: 'Start over!',
      artist: '櫻坂46',
      thumbnail_url: 'https://example.test/canonical-102.jpg',
    },
  ]);

  const result = await canonicalizeAppleMusicPresentation(
    { PAGES_RESPONSE_R2: r2, MINUTE_DB: db },
    observedAt,
  );

  assert.equal(result.updated, true);
  assert.equal(result.presentation_changed, true);
  assert.equal(db.reads, 1);

  const stored = JSON.parse(r2.values.get(READ_MODEL_KEY));
  const [samidare, startOver] = stored.regions[0].tracks;
  assert.equal(samidare.title, '五月雨よ');
  assert.equal(samidare.track_id, 101);
  assert.equal(samidare.apple_music_id, 'apple-101');
  assert.equal(samidare.rank, 1);
  assert.equal(samidare.artwork, 'https://example.test/101.jpg');
  assert.equal(startOver.title, 'Start over!');
  assert.equal(stored.canonical_presentation_version, 1);
  assert.equal(stored.canonical_presentation_checked_at, observedAt);

  const publicKey = pagesActionsR2ResponseKey(APPLE_MUSIC_PAGES_MODEL_KEY);
  const envelope = JSON.parse(r2.values.get(publicKey));
  const publicModel = JSON.parse(envelope.body);
  assert.equal(publicModel.regions[0].tracks[0].title, '五月雨よ');

  const writesAfterFirst = r2.putCount;
  const second = await canonicalizeAppleMusicPresentation(
    { PAGES_RESPONSE_R2: r2, MINUTE_DB: db },
    observedAt + 60 * 60_000,
  );
  assert.equal(second.updated, false);
  assert.equal(second.reason, 'fresh');
  assert.equal(r2.putCount, writesAfterFirst);
  assert.equal(db.reads, 1);
});
