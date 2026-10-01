import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalizeSpotifyPlaycountRows } from '../functions/api/spotify-playcounts.js';

class FakeCanonicalDb {
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
        if (sql.includes('FROM sh_tracks WHERE stationhead_track_id IN')) return { results: [] };
        if (sql.includes('FROM sh_track_canonical_metadata WHERE track_id IN')) {
          const ids = new Set(this.args.map(Number));
          return { results: database.rows.filter((row) => ids.has(Number(row.track_id))) };
        }
        if (sql.includes('FROM sh_track_canonical_metadata WHERE track_id IS NOT NULL AND isrc IN')) {
          const values = new Set(this.args.map(String));
          return { results: database.rows.filter((row) => values.has(String(row.isrc))) };
        }
        if (sql.includes('FROM sh_track_canonical_metadata WHERE track_id IS NOT NULL AND spotify_id IN')) {
          const values = new Set(this.args.map(String));
          return { results: database.rows.filter((row) => values.has(String(row.spotify_id))) };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      },
    };
  }

  async batch() {}
}

function row(overrides = {}) {
  return {
    artist_key: 'sakurazaka46',
    snapshot_date: '2026-10-01',
    track_id: 101,
    spotify_track_id: 'spotify-101',
    name: 'Samidareyo',
    playcount: 123,
    delta: 4,
    collected_at: 1_800_000_000_000,
    is_carried_forward: 0,
    ...overrides,
  };
}

test('Spotify playcount presentation replaces provider titles with canonical titles by sh_tracks.id', async () => {
  const db = new FakeCanonicalDb([{
    track_id: 101,
    stationhead_track_id: null,
    isrc: 'JPAAA2600101',
    spotify_id: 'spotify-101',
    title: '五月雨よ',
    artist: '櫻坂46',
    thumbnail_url: null,
  }]);

  const result = await canonicalizeSpotifyPlaycountRows(db, [row()]);
  assert.equal(result[0].track_id, 101);
  assert.equal(result[0].spotify_track_id, 'spotify-101');
  assert.equal(result[0].name, '五月雨よ');
  assert.ok(db.reads >= 1);
});

test('Spotify playcount presentation can recover canonical identity from Spotify id', async () => {
  const db = new FakeCanonicalDb([{
    track_id: 202,
    stationhead_track_id: null,
    isrc: 'JPAAA2600202',
    spotify_id: 'spotify-202',
    title: '流れ弾',
    artist: '櫻坂46',
    thumbnail_url: null,
  }]);

  const result = await canonicalizeSpotifyPlaycountRows(db, [row({
    track_id: null,
    spotify_track_id: 'spotify-202',
    name: 'Nagaredama',
  })]);
  assert.equal(result[0].track_id, 202);
  assert.equal(result[0].name, '流れ弾');
});
