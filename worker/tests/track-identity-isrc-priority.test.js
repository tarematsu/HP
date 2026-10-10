import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { resolveTracksAliasFirst } from '../src/minute-track-resolution-optimized.js';

test('canonical ISRC rows outrank legacy aliases before metadata writes', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE sh_tracks(id INTEGER PRIMARY KEY,canonical_key TEXT UNIQUE,isrc TEXT UNIQUE,spotify_id TEXT UNIQUE,stationhead_track_id INTEGER UNIQUE,title TEXT,artist TEXT,first_seen_at INTEGER,last_seen_at INTEGER);
    CREATE TABLE sh_track_aliases(alias_type TEXT,alias_value TEXT,track_id INTEGER,first_seen_at INTEGER,last_seen_at INTEGER,PRIMARY KEY(alias_type,alias_value));`);
  sqlite.prepare('INSERT INTO sh_tracks VALUES(?,?,?,?,?,?,?,?,?)').run(1,'legacy_name:song',null,null,null,'Song','Artist',0,0);
  sqlite.prepare('INSERT INTO sh_tracks VALUES(?,?,?,?,?,?,?,?,?)').run(2,'isrc:JPTEST0000001','JPTEST0000001',null,null,'Song','Artist',0,0);
  sqlite.prepare('INSERT INTO sh_track_aliases VALUES(?,?,?,?,?)').run('legacy_name','song\u001fartist',1,0,0);
  const reads = [];
  const db = {
    prepare(sql) { return { bind(...args) { return {
      async all() { reads.push(sql); return { results: sqlite.prepare(sql).all(...args) }; },
      async run() { return sqlite.prepare(sql).run(...args); },
    }; } }; },
    async batch(statements) { for (const statement of statements) await statement.run(); },
  };
  const track = { title: 'Song', artist: 'Artist', isrc: 'JPTEST0000001', amazon_music_id: 'NEW-AMAZON' };
  const resolved = await resolveTracksAliasFirst(db, null, [track], 1000);
  assert.equal(resolved[0].trackId, 2);
  assert.equal(sqlite.prepare('SELECT isrc FROM sh_tracks WHERE id=1').get().isrc, null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM sh_tracks').get().count, 2);
  assert.equal(sqlite.prepare("SELECT track_id FROM sh_track_aliases WHERE alias_type='isrc'").get().track_id, 2);
  reads.length = 0;
  assert.equal((await resolveTracksAliasFirst(db, null, [track], 2000))[0].trackId, 2);
  assert.equal(reads.filter(sql => /FROM sh_tracks WHERE/.test(sql)).length, 0, 'known authoritative ISRC aliases retain the fast path');
  sqlite.close();
});
