import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { queueActiveReleases, syncCollectionRoster } from '../src/spotify-playcount-schedule.js';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE sh_spotify_artists (
      artist_key TEXT PRIMARY KEY, spotify_artist_id TEXT, artist_name TEXT
    );
    CREATE TABLE sh_spotify_top20_history (
      ranking_date TEXT, artist_key TEXT, rank INTEGER,
      PRIMARY KEY (ranking_date, artist_key)
    );
  `);
  let writes = 0;
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async all() { return { results: sqlite.prepare(sql).all(...args) }; },
        async run() {
          const result = sqlite.prepare(sql).run(...args);
          writes += Number(result.changes);
          return result;
        },
      };
    },
    async batch(statements) { return Promise.all(statements.map((stmt) => stmt.run())); },
  };
  return { sqlite, db, writes: () => writes };
}

test('unchanged Spotify roster sync writes no rows, while corrections still persist', async () => {
  const { sqlite, db, writes } = database();
  try {
    const first = await syncCollectionRoster(db);
    const initialWrites = writes();
    assert.ok(initialWrites > 0);
    assert.deepEqual(await syncCollectionRoster(db), first);
    assert.equal(writes(), initialWrites);

    sqlite.exec(`UPDATE sh_spotify_artists SET artist_name='old',spotify_artist_id='old'
      WHERE artist_key='sakurazaka46';
      UPDATE sh_spotify_top20_history SET rank=999 WHERE artist_key='sakurazaka46';`);
    assert.deepEqual(await syncCollectionRoster(db), first);
    assert.equal(writes() - initialWrites, 2);
    assert.equal(sqlite.prepare("SELECT rank FROM sh_spotify_top20_history WHERE artist_key='sakurazaka46'").get().rank, 16);
  } finally {
    sqlite.close();
  }
});

test('album batching preserves shared artist targets and skips unknown targets', async () => {
  const sent = [];
  let expectedAlbums;
  const env = {
    OTHER_DB: {
      prepare(sql) {
        return {
          async all() { return { results: [
            { album_id: 'shared', target_keys: 'a,b' },
            { album_id: 'single', target_keys: ' a,unknown' },
            { album_id: 'unknown', target_keys: 'unknown' },
          ] }; },
          bind(...args) { expectedAlbums = args[0]; return this; },
          async run() { assert.match(sql, /UPDATE sh_spotify_collection_runs/); },
        };
      },
    },
    SPOTIFY_PLAYCOUNT_QUEUE: { async sendBatch(messages) { sent.push(...messages); } },
  };
  const artists = [
    { artist_key: 'a', spotify_artist_id: 'artist-a' },
    { artist_key: 'b', spotify_artist_id: 'artist-b' },
  ];
  assert.equal(await queueActiveReleases(env, '2026-09-30', 'run', artists), 2);
  assert.equal(expectedAlbums, 2);
  assert.deepEqual(sent.map(({ body }) => [body.album_id, body.targets]), [
    ['shared', artists], ['single', [artists[0]]],
  ]);
  assert.ok(sent.every(({ body, contentType }) => contentType === 'json'
    && body.snapshot_date === '2026-09-30' && body.run_token === 'run'
    && body.message_type === 'spotify-playcount-album' && body.message_version === 3));
});

test('manual collection targets today in JST without consuming an older incomplete run', async () => {
  const { selectScheduledSnapshot } = await import('../src/spotify-playcount-schedule.js');
  const now = Date.parse('2026-10-02T09:00:00Z');
  const db = { prepare() { throw new Error('manual selection must not select an older run'); } };
  assert.deepEqual(await selectScheduledSnapshot(db, now, { manualSnapshotDate: '2026-10-02' }), {
    snapshotDate: '2026-10-02', forceRefresh: true, confirmationPass: true, recovery: 'manual',
  });
  await assert.rejects(selectScheduledSnapshot(db, now, { manualSnapshotDate: '2026-10-01' }), /today in JST/);
  await assert.rejects(selectScheduledSnapshot(db, now, { manualSnapshotDate: '2026-10-03' }), /today in JST/);
  assert.equal((await selectScheduledSnapshot(db, Date.parse('2026-10-02T15:00:00Z'), { manualSnapshotDate: '2026-10-03' })).snapshotDate, '2026-10-03');
});
