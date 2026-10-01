import assert from 'node:assert/strict';
import test from 'node:test';

import { loadReadModelTrackMetadata } from '../src/read-model-metadata-indexed.js';

class PhysicalDb {
  constructor(rows = [], { missing = false, aliases = [] } = {}) {
    this.rows = rows;
    this.aliases = aliases;
    this.missing = missing;
    this.queries = [];
  }

  prepare(sql) {
    const db = this;
    return {
      bindings: [],
      bind(...bindings) {
        this.bindings = bindings;
        return this;
      },
      async all() {
        db.queries.push({ sql, bindings: this.bindings });
        if (db.missing) throw new Error('no such table: sh_tracks');
        const wanted = new Set(this.bindings);
        if (/FROM sh_tracks t/.test(sql) && /LEFT JOIN sh_track_dictionary d/.test(sql)) {
          return { results: db.rows.filter((row) => wanted.has(row.track_id)) };
        }
        if (/SELECT id AS track_id,isrc\s+FROM sh_tracks/.test(sql)) {
          return { results: db.rows
            .filter((row) => wanted.has(row.isrc))
            .map((row) => ({ track_id: row.track_id, isrc: row.isrc })) };
        }
        if (/SELECT id AS track_id,spotify_id\s+FROM sh_tracks/.test(sql)) {
          return { results: db.rows
            .filter((row) => wanted.has(row.spotify_id))
            .map((row) => ({ track_id: row.track_id, spotify_id: row.spotify_id })) };
        }
        if (/FROM sh_track_aliases/.test(sql)) {
          const values = new Set(this.bindings.slice(1));
          const type = this.bindings[0];
          return { results: db.aliases
            .filter((row) => row.alias_type === type && values.has(row.alias_value))
            .map((row) => ({
              track_id: row.track_id,
              [type]: row.alias_value,
            })) };
        }
        if (/FROM sh_track_dictionary/.test(sql)) {
          const byIsrc = /WHERE isrc IN/.test(sql);
          return { results: db.rows
            .filter((row) => wanted.has(byIsrc ? row.isrc : row.spotify_id))
            .map((row) => ({ ...row, track_id: null })) };
        }
        return { results: [] };
      },
    };
  }
}

function row(id, suffix = String(id)) {
  return {
    track_id: id,
    spotify_id: `sp-${suffix}`,
    isrc: `JPAAA0000${String(id).padStart(3, '0')}`,
    title: `Song ${suffix}`,
    artist: 'Artist',
    thumbnail_url: `cover-${suffix}`,
    fetched_at: 10 + id,
  };
}

test('loader resolves ISRC through indexed sh_tracks and physical presentation owners', async () => {
  const expected = row(701, 'isrc-owner');
  const db = new PhysicalDb([expected]);
  const rows = await loadReadModelTrackMetadata({ MINUTE_DB: db }, [], [expected.isrc]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 701);
  assert.equal(rows[0].title, 'Song isrc-owner');
  assert.match(db.queries[0].sql, /SELECT id AS track_id,isrc/);
  assert.match(db.queries[1].sql, /FROM sh_tracks t/);
  assert.match(db.queries[1].sql, /LEFT JOIN sh_track_dictionary d/);
  assert.ok(db.queries.every(({ sql }) => !/sh_track_canonical_metadata/.test(sql)));
});

test('canonical track_id suppresses redundant provider alias lookups', async () => {
  const expected = row(702, 'track-owner');
  const db = new PhysicalDb([expected]);
  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB: db },
    [expected.spotify_id],
    [expected.isrc],
    [expected.track_id],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 702);
  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0].sql, /WHERE t\.id IN/);
  assert.deepEqual(db.queries[0].bindings, [702]);
});

test('same physical track requested by ISRC and Spotify is returned once', async () => {
  const expected = row(703, 'dedupe');
  const db = new PhysicalDb([expected]);
  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB: db },
    [expected.spotify_id],
    [expected.isrc],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 703);
  assert.equal(db.queries.some(({ sql }) => /spotify_id\s+FROM sh_tracks/.test(sql)), false);
});

test('Spotify-only identities resolve through indexed sh_tracks before presentation metadata', async () => {
  const expected = row(704, 'spotify-owner');
  const db = new PhysicalDb([expected]);
  const rows = await loadReadModelTrackMetadata({ MINUTE_DB: db }, [expected.spotify_id], []);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 704);
  assert.equal(rows[0].title, 'Song spotify-owner');
  assert.equal(db.queries.length, 2);
  assert.match(db.queries[0].sql, /SELECT id AS track_id,spotify_id/);
  assert.match(db.queries[1].sql, /WHERE t\.id IN/);
});

test('provider aliases are consulted only when direct sh_tracks identity misses', async () => {
  const expected = row(705, 'alias-owner');
  const db = new PhysicalDb([expected], {
    aliases: [{ alias_type: 'spotify_id', alias_value: 'legacy-sp-705', track_id: 705 }],
  });
  const rows = await loadReadModelTrackMetadata({ MINUTE_DB: db }, ['legacy-sp-705'], []);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, 705);
  assert.match(db.queries[0].sql, /FROM sh_tracks/);
  assert.match(db.queries[1].sql, /FROM sh_track_aliases/);
  assert.match(db.queries[2].sql, /FROM sh_tracks t/);
});

test('dictionary-only Spotify identities use the indexed dictionary', async () => {
  const expected = { ...row(706, 'dictionary-only'), track_id: null };
  const db = new PhysicalDb([expected]);
  const rows = await loadReadModelTrackMetadata({ MINUTE_DB: db }, [expected.spotify_id], []);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].track_id, null);
  assert.equal(rows[0].title, 'Song dictionary-only');
  assert.ok(db.queries.some(({ sql }) => /FROM sh_track_dictionary/.test(sql)));
});

test('BUDDIES metadata is not blended into available physical metadata', async () => {
  const expected = row(707, 'complete');
  const primary = new PhysicalDb([expected]);
  const fallback = {
    prepare() {
      throw new Error('BUDDIES_DB must not be queried when physical owners are available');
    },
  };
  const rows = await loadReadModelTrackMetadata(
    { MINUTE_DB: primary, BUDDIES_DB: fallback },
    [expected.spotify_id, 'missing-707'],
    [expected.isrc],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spotify_id, expected.spotify_id);
});

test('missing physical schema uses the rolling-migration fallback only when provided', async () => {
  const db = new PhysicalDb([], { missing: true });
  const rows = await loadReadModelTrackMetadata({ MINUTE_DB: db }, ['sp-missing-schema'], []);
  assert.deepEqual(rows, []);
});

test('loader enforces the existing eighty-key bound per identifier type', async () => {
  const db = new PhysicalDb();
  const values = Array.from({ length: 100 }, (_, index) => `limit-key-${index}`);
  await loadReadModelTrackMetadata({ MINUTE_DB: db }, values, []);
  assert.equal(db.queries[0].bindings.length, 80);
  assert.match(db.queries[0].sql, /FROM sh_tracks/);
});
