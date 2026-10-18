import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { spotifyLatestSnapshotDatesSql, loadSpotifyLatestDetailRows } from '../src/spotify-read-model-detail.js';

test('latest dates preserve independent artist dates without historical aggregation', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE sh_spotify_artist_daily (
      snapshot_date TEXT NOT NULL, artist_key TEXT NOT NULL,
      PRIMARY KEY(snapshot_date,artist_key));
      WITH RECURSIVE days(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM days WHERE n<2000)
      INSERT INTO sh_spotify_artist_daily
      SELECT date('2020-01-01','+'||n||' day'),artist_key FROM days
      CROSS JOIN (SELECT 'sakurazaka46' AS artist_key UNION ALL SELECT 'nogizaka46' UNION ALL SELECT 'hinatazaka46');
      DELETE FROM sh_spotify_artist_daily WHERE artist_key='hinatazaka46'
        AND snapshot_date=(SELECT MAX(snapshot_date) FROM sh_spotify_artist_daily);`);
    const keys = ['sakurazaka46','nogizaka46','hinatazaka46','missing'];
    const expected = db.prepare(`SELECT artist_key,MAX(snapshot_date) AS snapshot_date
      FROM sh_spotify_artist_daily WHERE artist_key IN (?,?,?,?) GROUP BY artist_key`).all(...keys);
    const actual = db.prepare(spotifyLatestSnapshotDatesSql(4)).all(...keys);
    assert.deepEqual(actual.filter(row => row.snapshot_date).sort((a,b) => a.artist_key.localeCompare(b.artist_key)),
      expected.sort((a,b) => a.artist_key.localeCompare(b.artist_key)));
    assert.equal(actual.find(row => row.artist_key === 'missing').snapshot_date, null);
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + spotifyLatestSnapshotDatesSql(3))
      .all(...keys.slice(0,3)).map(row => row.detail).join('\n');
    assert.doesNotMatch(plan, /TEMP B-TREE/);
  } finally { db.close(); }
});

test('an artist without a summary never triggers a detail read', async () => {
  let queries = 0;
  const db = { prepare(sql) {
    queries += 1;
    assert.equal(sql, spotifyLatestSnapshotDatesSql(1));
    return { bind: () => ({ all: async () => ({ results: [{ artist_key: 'sakurazaka46', snapshot_date: null }] }) }) };
  } };
  assert.deepEqual(await loadSpotifyLatestDetailRows(db, ['sakurazaka46']), []);
  assert.equal(queries, 1);
});
