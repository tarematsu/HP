import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolveTracksBulk } from '../src/minute-facts-track-resolution.js';
import { TRACK_SEEN_CHECKPOINT_MS } from '../src/minute-track-write-statements.js';
import { withMinuteD1WriteThrottling } from '../src/minute-d1-write-throttle.js';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../database/facts-migrations/001_initial_schema.sql', import.meta.url), 'utf8'));
  const reads = [];
  let changedRows = 0;
  const statement = (sql, args = []) => ({
    bind(...values) { return statement(sql, values); },
    async all() { reads.push({ sql, args }); return { results: sqlite.prepare(sql).all(...args) }; },
    async first() { reads.push({ sql, args }); return sqlite.prepare(sql).get(...args) ?? null; },
    async run() {
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
    sqlite, reads, db: withMinuteD1WriteThrottling({ MINUTE_DB: raw }).MINUTE_DB,
    changes: () => changedRows,
    reset() { changedRows = 0; reads.length = 0; },
  };
}

test('bulk resolution reuses known aliases without identity-table reads or observation-only writes', async () => {
  const fixture = database();
  const { db, sqlite, reads } = fixture;
  const tracks = [{ position: 0, isrc: 'JPTEST0000001', spotify_id: 'song-1', title: 'Song', artist: 'Artist' }];
  const first = await resolveTracksBulk(db, null, tracks, 1000);
  assert.ok(Number.isFinite(first[0].trackId));
  fixture.reset();
  const next = await resolveTracksBulk(db, null, tracks, 2000);
  assert.equal(next[0].trackId, first[0].trackId);
  assert.equal(reads.filter(({ sql }) => /FROM sh_tracks/.test(sql)).length, 0);
  assert.equal(fixture.changes(), 0);
  assert.equal(sqlite.prepare('SELECT last_seen_at FROM sh_tracks').get().last_seen_at, 1000);
  await resolveTracksBulk(db, null, tracks, 1000 + TRACK_SEEN_CHECKPOINT_MS);
  assert.equal(sqlite.prepare('SELECT last_seen_at FROM sh_tracks').get().last_seen_at, 1000 + TRACK_SEEN_CHECKPOINT_MS);
  assert.ok(sqlite.prepare('SELECT last_seen_at FROM sh_track_aliases').all().every((row) => row.last_seen_at === 1000 + TRACK_SEEN_CHECKPOINT_MS));
  fixture.reset();
  await resolveTracksBulk(db, null, tracks, 500);
  assert.equal(fixture.changes(), 0, 'delayed payload must not move checkpoints backwards');
  await resolveTracksBulk(db, null, [], 3000);
  assert.equal(fixture.changes(), 0);
  sqlite.close();
});

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
