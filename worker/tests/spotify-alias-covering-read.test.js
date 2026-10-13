import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { spotifyKnownAliasStatement } from '../src/spotify-track-identity.js';

const migration = readFileSync(
  new URL('../../database/other-migrations/074_spotify_alias_covering_source_lookup.sql', import.meta.url),
  'utf8',
);

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sh_spotify_track_aliases (
      source_track_id TEXT PRIMARY KEY,
      song_key TEXT NOT NULL,
      canonical_track_id TEXT NOT NULL,
      first_seen_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE INDEX idx_sh_spotify_track_aliases_canonical
      ON sh_spotify_track_aliases(canonical_track_id, source_track_id);
  `);
  const insert = sqlite.prepare(`INSERT INTO sh_spotify_track_aliases
    (source_track_id,song_key,canonical_track_id,first_seen_at,last_seen_at)
    VALUES (?,?,?,?,?)`);
  for (let index = 0; index < 350; index++) {
    insert.run(`source-${index}`, `song-${index}`,
      `canonical-${index % 100}`, 1000 + index, 2000 + index);
  }
  return sqlite;
}

function adapter(sqlite) {
  return { prepare(sql) {
    return { bind(...bindings) {
      return {
        async all() { return { results: sqlite.prepare(sql).all(...bindings) }; },
        sql,
        bindings,
      };
    } };
  } };
}

test('source-alias covering index preserves results and eliminates row-body lookup', async () => {
  const sqlite = fixture();
  try {
    sqlite.exec(migration);
    sqlite.exec(migration); // idempotent for reruns / partially applied deploys
    const ids = ['source-234', 'source-17', 'missing', 'source-0', 'source-349'];
    const stmt = spotifyKnownAliasStatement(adapter(sqlite), ids);
    const actual = (await stmt.all()).results.map(row => ({ ...row }));
    const baseline = sqlite.prepare(`SELECT
      source_track_id,song_key,canonical_track_id,last_seen_at
      FROM sh_spotify_track_aliases WHERE source_track_id IN (?,?,?,?,?)`)
      .all(...ids).map(row => ({ ...row }));
    assert.deepEqual(actual, baseline);
    assert.equal(actual.length, 4);

    const plan = sqlite.prepare('EXPLAIN QUERY PLAN ' + stmt.sql)
      .all(...stmt.bindings).map(row => row.detail).join('\n');
    assert.match(plan, /SEARCH sh_spotify_track_aliases USING COVERING INDEX idx_sh_spotify_track_aliases_source_cover/);
    assert.doesNotMatch(plan, /SCAN sh_spotify_track_aliases/);

    sqlite.prepare(`UPDATE sh_spotify_track_aliases SET song_key=?, canonical_track_id=?,last_seen_at=?
      WHERE source_track_id=?`).run('renamed', 'canon-renamed', 5000, 'source-17');
    assert.deepEqual((await spotifyKnownAliasStatement(adapter(sqlite), ['source-17']).all()).results.map(row => ({ ...row })), [{
      source_track_id: 'source-17',
      song_key: 'renamed',
      canonical_track_id: 'canon-renamed',
      last_seen_at: 5000,
    }]);
  } finally {
    sqlite.close();
  }
});

test('source-alias lookup bounds preserve the existing D1 chunk size', () => {
  const sqlite = fixture();
  try {
    const db = adapter(sqlite);
    assert.throws(() => spotifyKnownAliasStatement(db, []), /1-80/);
    assert.throws(() => spotifyKnownAliasStatement(db, Array(81).fill('track')), /1-80/);
    assert.doesNotThrow(() => spotifyKnownAliasStatement(db, Array(80).fill('track')));
  } finally {
    sqlite.close();
  }
});
