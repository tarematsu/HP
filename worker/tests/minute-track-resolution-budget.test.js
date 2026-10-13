import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolveTracksAliasFirst } from '../src/minute-track-resolution-optimized.js';
import { resolveTracksBulk } from '../src/minute-facts-track-resolution.js';
import { TRACK_SEEN_CHECKPOINT_MS } from '../src/minute-track-write-statements.js';
import { withMinuteD1WriteThrottling } from '../src/minute-d1-write-throttle.js';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../database/facts-migrations/001_initial_schema.sql', import.meta.url), 'utf8'));
  const reads = [];
  const writes = [];
  let changedRows = 0;
  const statement = (sql, args = []) => ({
    bind(...values) { return statement(sql, values); },
    async all() { reads.push({ sql, args }); return { results: sqlite.prepare(sql).all(...args) }; },
    async first() { reads.push({ sql, args }); return sqlite.prepare(sql).get(...args) ?? null; },
    async run() {
      writes.push({ sql, args });
      const changes = Number(sqlite.prepare(sql).run(...args).changes);
      changedRows += changes;
      return { success: true, meta: { changes } };
    },
  });
  const raw = {
    prepare: statement,
    async batch(statements) { return Promise.all(statements.map((item) => item.run())); },
  };
  return {
    sqlite, reads, writes, db: withMinuteD1WriteThrottling({ MINUTE_DB: raw }).MINUTE_DB,
    changes: () => changedRows,
    reset() { changedRows = 0; reads.length = 0; writes.length = 0; },
  };
}

for (const resolve of [resolveTracksBulk, resolveTracksAliasFirst]) {
test(`${resolve.name}: known aliases skip identity reads and redundant upsert statements`, async () => {
  const fixture = database();
  const { db, sqlite, reads } = fixture;
  const tracks = [{ position: 0, isrc: 'JPTEST0000001', spotify_id: 'song-1', title: 'Song', artist: 'Artist' }];
  const first = await resolve(db, null, tracks, 1000);
  assert.ok(Number.isFinite(first[0].trackId));
  fixture.reset();
  const next = await resolve(db, null, tracks, 2000);
  assert.equal(next[0].trackId, first[0].trackId);
  assert.equal(reads.filter(({ sql }) => /FROM sh_tracks/.test(sql)).length, 0);
  assert.equal(fixture.changes(), 0);
  assert.equal(fixture.writes.filter(({ sql }) => /INSERT INTO sh_track_aliases/.test(sql)).length, 0);
  assert.equal(sqlite.prepare('SELECT last_seen_at FROM sh_tracks').get().last_seen_at, 1000);
  await resolve(db, null, tracks, 1000 + TRACK_SEEN_CHECKPOINT_MS);
  assert.equal(sqlite.prepare('SELECT last_seen_at FROM sh_tracks').get().last_seen_at, 1000 + TRACK_SEEN_CHECKPOINT_MS);
  assert.ok(sqlite.prepare('SELECT last_seen_at FROM sh_track_aliases').all().every((row) => row.last_seen_at === 1000 + TRACK_SEEN_CHECKPOINT_MS));
  fixture.reset();
  await resolve(db, null, tracks, 500);
  assert.equal(fixture.changes(), 0, 'delayed payload must not move checkpoints backwards');
  await resolve(db, null, [], 3000);
  assert.equal(fixture.changes(), 0);
  assert.equal(fixture.writes.filter(({ sql }) => /INSERT INTO sh_track_aliases/.test(sql)).length, 0);
  sqlite.close();
});

}

test('new metadata and aliases fill immediately despite a recent checkpoint', async () => {
  const fixture = database();
  const { db, sqlite } = fixture;
  const first = await resolveTracksBulk(db, null, [{ position: 0, spotify_id: 'song-1' }], 1000);
  fixture.reset();
  const tracks = [{ position: 0, spotify_id: 'song-1', isrc: 'JPTEST0000001', stationhead_track_id: 42, title: 'Song', artist: 'Artist' }];
  const next = await resolveTracksBulk(db, null, tracks, 2000);
  assert.equal(next[0].trackId, first[0].trackId);
  const row = sqlite.prepare('SELECT isrc,stationhead_track_id,title,artist FROM sh_tracks').get();
  assert.deepEqual({ ...row }, { isrc: 'JPTEST0000001', stationhead_track_id: 42, title: 'Song', artist: 'Artist' });
  assert.equal(sqlite.prepare("SELECT track_id FROM sh_track_aliases WHERE alias_type='isrc'").get().track_id, first[0].trackId);
  fixture.reset();
  const mixed = await resolveTracksBulk(db, null, [...tracks, { position: 1, isrc: 'JPTEST0000002' }], 3000);
  assert.equal(mixed[0].trackId, first[0].trackId);
  assert.notEqual(mixed[1].trackId, first[0].trackId);
  const identityReads = fixture.reads.filter(({ sql }) => /FROM sh_tracks/.test(sql));
  assert.ok(identityReads.length > 0);
  assert.ok(identityReads.every(({ args }) => !args.includes('JPTEST0000001') && !args.includes('song-1')));
  sqlite.close();
});

test('bulk metadata lookup is limited to missing presentation fields', async () => {
  const fixture = database();
  const { db, sqlite } = fixture;
  sqlite.exec(`CREATE TABLE sh_track_metadata(spotify_id TEXT PRIMARY KEY,title TEXT,artist TEXT);
    INSERT INTO sh_track_metadata VALUES('song-1','Stored title','Stored artist');`);
  const complete = [{ position: 0, spotify_id: 'song-1', title: 'Input title', artist: 'Input artist' }];
  const resolved = await resolveTracksBulk(db, null, complete, 1000);
  assert.equal(resolved[0].title, 'Input title');
  assert.equal(resolved[0].artist, 'Input artist');
  assert.equal(fixture.reads.filter(({ sql }) => /FROM sh_track_metadata/.test(sql)).length, 0);
  fixture.reset();
  const partial = await resolveTracksBulk(db, null, [{ position: 0, spotify_id: 'song-1', title: 'Input title' }], 2000);
  assert.equal(partial[0].title, 'Input title');
  assert.equal(partial[0].artist, 'Stored artist');
  assert.equal(fixture.reads.filter(({ sql }) => /FROM sh_track_metadata/.test(sql)).length, 1);
  sqlite.close();
});
