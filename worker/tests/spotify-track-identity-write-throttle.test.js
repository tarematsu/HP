import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { resolveCanonicalSpotifyTracks } from '../src/spotify-track-identity.js';

function boundStatement(sqlite, sql, bindings = []) {
  return {
    sql,
    bindings,
    bind(...nextBindings) {
      return boundStatement(sqlite, sql, nextBindings);
    },
    async first() {
      const row = sqlite.prepare(sql).get(...bindings);
      return row ? { ...row } : null;
    },
    async all() {
      return {
        results: sqlite.prepare(sql).all(...bindings).map((row) => ({ ...row })),
      };
    },
    async run() {
      const result = sqlite.prepare(sql).run(...bindings);
      return { meta: { changes: Number(result.changes || 0) } };
    },
  };
}

function d1(sqlite) {
  return {
    prepare(sql) {
      return boundStatement(sqlite, sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sh_spotify_song_identities (
      song_key TEXT PRIMARY KEY,
      canonical_track_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE sh_spotify_track_aliases (
      source_track_id TEXT PRIMARY KEY,
      song_key TEXT NOT NULL,
      canonical_track_id TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
  `);
  return sqlite;
}

function totalChanges(sqlite) {
  return Number(sqlite.prepare('SELECT total_changes() AS value').get().value);
}

function track(name = 'Song A') {
  return {
    track_id: 'track-1',
    name,
    duration_ms: 180_000,
    artists_json: JSON.stringify([{ id: 'artist-1' }]),
  };
}

test('stable Spotify identity mappings use the fast path and refresh weekly', async () => {
  const sqlite = createDatabase();
  const db = d1(sqlite);
  const start = Date.UTC(2026, 8, 28, 0, 0, 0);

  const initial = await resolveCanonicalSpotifyTracks(db, [track()], start);
  const afterInsert = totalChanges(sqlite);
  assert.equal(afterInsert, 2);
  assert.equal(initial[0].identity_cached, false);

  const cached = await resolveCanonicalSpotifyTracks(db, [track()], start + 60 * 60 * 1000);
  assert.equal(totalChanges(sqlite), afterInsert);
  assert.equal(cached[0].identity_cached, true);
  assert.equal(cached[0].track_id, 'track-1');

  const identityBeforeRefresh = {
    ...sqlite.prepare('SELECT created_at,updated_at FROM sh_spotify_song_identities').get(),
  };
  const aliasBeforeRefresh = {
    ...sqlite.prepare('SELECT first_seen_at,last_seen_at FROM sh_spotify_track_aliases').get(),
  };
  assert.deepEqual(identityBeforeRefresh, { created_at: start, updated_at: start });
  assert.deepEqual(aliasBeforeRefresh, { first_seen_at: start, last_seen_at: start });

  const refreshAt = start + 7 * 24 * 60 * 60 * 1000;
  const refreshed = await resolveCanonicalSpotifyTracks(db, [track()], refreshAt);
  assert.equal(totalChanges(sqlite), afterInsert + 2);
  assert.equal(refreshed[0].identity_cached, false);
  assert.equal(
    Number(sqlite.prepare('SELECT updated_at FROM sh_spotify_song_identities').get().updated_at),
    refreshAt,
  );
  assert.equal(
    Number(sqlite.prepare('SELECT last_seen_at FROM sh_spotify_track_aliases').get().last_seen_at),
    refreshAt,
  );
});

test('changed Spotify identity mapping bypasses the fast path immediately', async () => {
  const sqlite = createDatabase();
  const db = d1(sqlite);
  const start = Date.UTC(2026, 8, 28, 0, 0, 0);

  await resolveCanonicalSpotifyTracks(db, [track('Song A')], start);
  const afterInsert = totalChanges(sqlite);
  const changed = await resolveCanonicalSpotifyTracks(db, [track('Song B')], start + 60_000);

  assert.equal(totalChanges(sqlite), afterInsert + 2);
  assert.equal(changed[0].identity_cached, false);
  const alias = {
    ...sqlite.prepare(`SELECT song_key,canonical_track_id,last_seen_at
      FROM sh_spotify_track_aliases WHERE source_track_id='track-1'`).get(),
  };
  assert.match(alias.song_key, /song b/);
  assert.equal(alias.canonical_track_id, 'track-1');
  assert.equal(Number(alias.last_seen_at), start + 60_000);
});
