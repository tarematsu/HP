import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

const read = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');

test('all regional upserts skip exact replays while preserving changed fields and observation times', () => {
  const queries = [...read('regional-music-store.js').matchAll(/`(INSERT INTO regional_music_[\s\S]*?)`/g)].map(m => m[1]);
  assert.equal(queries.length, 10);
  const db = new DatabaseSync(':memory:');
  for (const sql of queries) {
    const [, table, rawColumns] = sql.match(/INSERT INTO (\w+)\(\s*([\s\S]*?)\)\s*VALUES/);
    const columns = rawColumns.split(',').map(x => x.trim());
    const conflict = sql.match(/ON CONFLICT\((.*?)\)/)[1];
    db.exec(`CREATE TABLE ${table}(${columns.join(',')}, UNIQUE(${conflict}))`);
  }
  for (const sql of queries) {
    const statement = db.prepare(sql);
    const args = Array((sql.match(/\?/g) || []).length).fill(1);
    assert.equal(statement.run(...args).changes, 1);
    assert.equal(statement.run(...args).changes, 0);
    const rawColumns = sql.match(/INSERT INTO \w+\(\s*([\s\S]*?)\)\s*VALUES/)[1];
    const columns = rawColumns.split(',').map(x => x.trim());
    const timeIndex = columns.findIndex(x => ['observed_at', 'last_seen_at', 'updated_at'].includes(x));
    args[timeIndex] = 2;
    assert.equal(statement.run(...args).changes, 1, columns.join(','));
    assert.equal(statement.run(...args).changes, 0);
  }
  db.close();
});

test('Spotify candidate winners skip losing album observations and preserve equal-count newer timestamps', () => {
  const sql = read('spotify-playcount-consumer.js').match(/`(INSERT INTO sh_spotify_playcount_candidates[\s\S]*?)`/)[1];
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE sh_spotify_collection_runs(snapshot_date,run_token,status);
    INSERT INTO sh_spotify_collection_runs VALUES('2026-10-09','run','queued');
    CREATE TABLE sh_spotify_playcount_candidates(snapshot_date,run_token,track_id,album_id,playcount,collected_at,UNIQUE(snapshot_date,track_id));`);
  const statement = db.prepare(sql);
  const run = (album, count, time) => statement.run('2026-10-09','run','track',album,count,time,'2026-10-09','run','2026-10-09','run').changes;
  assert.equal(run('album-a',100,1000),1);
  assert.equal(run('album-b',90,2000),0);
  assert.equal(run('album-a',100,1000),0);
  assert.equal(run('album-a',100,2000),1);
  assert.equal(run('album-b',110,3000),1);
  assert.equal(db.prepare('SELECT playcount FROM sh_spotify_playcount_candidates').get().playcount,110);
  db.close();
});
