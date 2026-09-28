import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  bootstrapSpotifyTrackAliases,
  resetSpotifyAliasBootstrapVerification,
} from '../src/spotify-track-identity.js';

const migration = readFileSync(
  new URL('../../database/other-migrations/046_spotify_alias_bootstrap_progress.sql', import.meta.url),
  'utf8',
);

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

function d1(sqlite, preparedSql) {
  return {
    prepare(sql) {
      preparedSql.push(sql);
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
    CREATE TABLE sh_spotify_tracks (
      track_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      duration_ms INTEGER,
      artists_json TEXT NOT NULL
    );
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
  sqlite.exec(migration);

  const insertTrack = sqlite.prepare(`INSERT INTO sh_spotify_tracks
    (track_id,name,duration_ms,artists_json) VALUES (?,?,?,?)`);
  const insertAlias = sqlite.prepare(`INSERT INTO sh_spotify_track_aliases
    (source_track_id,song_key,canonical_track_id,first_seen_at,last_seen_at)
    VALUES (?,?,?,?,?)`);
  for (let index = 0; index <= 100; index += 1) {
    const trackId = `track-${String(index).padStart(3, '0')}`;
    insertTrack.run(
      trackId,
      `Song ${index}`,
      180_000 + index,
      JSON.stringify([{ id: 'artist-1' }]),
    );
    if (index < 100) {
      insertAlias.run(trackId, `legacy:${trackId}`, trackId, 1, 1);
    }
  }
  return sqlite;
}

function progress(sqlite) {
  const row = sqlite.prepare(`SELECT cursor_track_id,is_complete
    FROM sh_spotify_maintenance_state
    WHERE maintenance_key='legacy-alias-bootstrap-v1'`).get();
  return row ? { ...row } : null;
}

test('legacy alias bootstrap advances in bounded windows and stops permanently', async () => {
  resetSpotifyAliasBootstrapVerification();
  const sqlite = createDatabase();
  const preparedSql = [];
  const db = d1(sqlite, preparedSql);

  assert.equal(await bootstrapSpotifyTrackAliases(db, 10), 0);
  assert.deepEqual(progress(sqlite), { cursor_track_id: 'track-099', is_complete: 0 });

  const scansAfterFirstWindow = preparedSql.filter((sql) => /FROM sh_spotify_tracks track/.test(sql));
  assert.equal(scansAfterFirstWindow.length, 1);
  assert.match(scansAfterFirstWindow[0], /WHERE track\.track_id>\?/);
  assert.match(scansAfterFirstWindow[0], /LIMIT 100/);
  assert.doesNotMatch(scansAfterFirstWindow[0], /WHERE alias\.source_track_id IS NULL/);

  assert.equal(await bootstrapSpotifyTrackAliases(db, 20), 1);
  assert.deepEqual(progress(sqlite), { cursor_track_id: 'track-100', is_complete: 1 });
  assert.deepEqual(
    { ...sqlite.prepare(`SELECT source_track_id,canonical_track_id
      FROM sh_spotify_track_aliases WHERE source_track_id='track-100'`).get() },
    { source_track_id: 'track-100', canonical_track_id: 'track-100' },
  );

  const scansAfterCompletion = preparedSql.filter((sql) => /FROM sh_spotify_tracks track/.test(sql));
  assert.equal(scansAfterCompletion.length, 2);
  const callsBeforeCachedRetry = preparedSql.length;
  assert.equal(await bootstrapSpotifyTrackAliases(db, 30), 0);
  assert.equal(preparedSql.length, callsBeforeCachedRetry);

  resetSpotifyAliasBootstrapVerification();
  const callsBeforeNewIsolate = preparedSql.length;
  assert.equal(await bootstrapSpotifyTrackAliases(db, 40), 0);
  assert.equal(preparedSql.length, callsBeforeNewIsolate + 1);
  assert.equal(preparedSql.filter((sql) => /FROM sh_spotify_tracks track/.test(sql)).length, 2);

  resetSpotifyAliasBootstrapVerification();
});
