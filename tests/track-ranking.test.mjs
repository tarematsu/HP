import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  loadTrackRanking,
  TRACK_RANKING_SQL,
} from '../site/functions/lib/track-ranking.js';

const materializedMigration = readFileSync(
  new URL('../database/facts-migrations/032_materialized_cleanup_ranking.sql', import.meta.url),
  'utf8',
);

function rankingDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sh_minute_fact_jobs(
      id INTEGER PRIMARY KEY,status TEXT NOT NULL,payload_json TEXT NOT NULL,
      processed_at INTEGER,updated_at INTEGER NOT NULL
    );
    CREATE TABLE sh_queue_revisions(
      id INTEGER PRIMARY KEY,source_job_id INTEGER,status TEXT NOT NULL,
      materialized_item_count INTEGER,source_visible_count INTEGER,item_count INTEGER
    );
    CREATE TABLE sh_tracks(
      id INTEGER PRIMARY KEY,
      stationhead_track_id INTEGER,
      spotify_id TEXT,
      isrc TEXT,
      title TEXT,
      artist TEXT,
      display_title TEXT,
      thumbnail_url TEXT,
      spotify_url TEXT,
      updated_at INTEGER
    );
    CREATE TABLE sh_track_metadata(
      spotify_id TEXT PRIMARY KEY,
      isrc TEXT,
      title TEXT,
      artist TEXT,
      display_title TEXT,
      thumbnail_url TEXT,
      fetched_at INTEGER
    );
    CREATE TABLE sh_track_dictionary(
      isrc TEXT PRIMARY KEY,
      spotify_id TEXT,
      title TEXT,
      artist TEXT,
      thumbnail_url TEXT,
      metadata_fetched_at INTEGER
    );
    CREATE TABLE sh_track_counter_current(
      occurrence_key TEXT PRIMARY KEY,
      track_key TEXT NOT NULL,
      track_id INTEGER,
      isrc TEXT,
      spotify_id TEXT,
      count_value INTEGER NOT NULL,
      observed_at INTEGER NOT NULL
    );
    INSERT INTO sh_tracks VALUES
      (1,10,'sp1','JPTEST1','A','櫻坂46','A — 櫻坂46',NULL,NULL,100),
      (2,20,'sp2','JPTEST2','B','Artist B','B — Artist B',NULL,NULL,100),
      (3,30,'sp3','USTEST3','C','Artist C','C — Artist C',NULL,NULL,100);
    INSERT INTO sh_track_counter_current VALUES
      ('occ-1','isrc:JPTEST1',1,'JPTEST1','sp1',20,2000),
      ('occ-2','isrc:JPTEST1',1,'JPTEST1','sp1',25,2500),
      ('occ-3','isrc:JPTEST2',2,'JPTEST2','sp2',5,2100),
      ('occ-4','isrc:USTEST3',3,'USTEST3','sp3',99,2600);
  `);
  db.exec(materializedMigration);
  db.exec(`
    CREATE VIEW sh_track_canonical_metadata AS
    SELECT
      t.id AS track_id,
      t.isrc,
      COALESCE(d.spotify_id,t.spotify_id) AS spotify_id,
      COALESCE(NULLIF(d.title,''),NULLIF(t.title,'')) AS title,
      COALESCE(NULLIF(d.artist,''),NULLIF(t.artist,'')) AS artist,
      d.thumbnail_url,
      COALESCE(d.metadata_fetched_at,t.updated_at) AS fetched_at
    FROM sh_tracks AS t
    LEFT JOIN sh_track_dictionary AS d ON d.isrc=t.isrc
    UNION ALL
    SELECT
      NULL AS track_id,d.isrc,d.spotify_id,d.title,d.artist,d.thumbnail_url,d.metadata_fetched_at
    FROM sh_track_dictionary AS d
    WHERE NOT EXISTS (
      SELECT 1 FROM sh_tracks AS t
      WHERE t.isrc=d.isrc OR (d.spotify_id IS NOT NULL AND t.spotify_id=d.spotify_id)
    );
  `);
  return db;
}

function d1Adapter(db, calls = null) {
  return {
    prepare(sql) {
      if (calls) calls.push(sql);
      const statement = db.prepare(sql);
      return {
        bind(...args) {
          return {
            async all() { return { results: statement.all(...args) }; },
            async first() { return statement.get(...args) || null; },
            async run() { return statement.run(...args); },
          };
        },
        async first() { return statement.get() || null; },
      };
    },
  };
}

test('ranking scan avoids three canonical metadata joins and resolves direct track ids once', async () => {
  assert.match(TRACK_RANKING_SQL, /FROM sh_track_ranking_current current/);
  assert.doesNotMatch(TRACK_RANKING_SQL, /JOIN sh_track_canonical_metadata/);

  const db = rankingDatabase();
  const calls = [];
  await loadTrackRanking(d1Adapter(db, calls), { limit: 500, persist: false });
  const canonicalCalls = calls.filter((sql) => sql.includes('FROM sh_track_canonical_metadata'));
  assert.equal(canonicalCalls.length, 1);
  assert.match(canonicalCalls[0], /WHERE track_id IN/);
  assert.doesNotMatch(canonicalCalls[0], /WHERE isrc IN|WHERE spotify_id IN/);
});

test('track ranking is seeded and maintained at counter update time', async () => {
  const db = rankingDatabase();
  const initial = await loadTrackRanking(d1Adapter(db), { limit: 500 });
  assert.equal(initial.rows[0].latest_like_count, 25);
  assert.equal(initial.rows[0].latest_observed_at, 2500);
  assert.equal(initial.rows[1].latest_like_count, 5);
  assert.equal(initial.summary.track_count, 2);
  assert.equal(initial.summary.max_like_count, 25);
  assert.equal(initial.summary.latest_observed_at, 2500);

  db.prepare(`UPDATE sh_track_counter_current
    SET count_value=30,observed_at=3000 WHERE occurrence_key='occ-3'`).run();
  const updated = await loadTrackRanking(d1Adapter(db), { limit: 500 });
  assert.equal(updated.rows[0].latest_occurrence_key, 'occ-3');
  assert.equal(updated.rows[0].latest_like_count, 30);
  assert.equal(updated.rows[0].rank, 1);
  assert.equal(updated.summary.max_like_count, 30);
});

test('track ranking reads placeholder replacements from canonical dictionary without duplicating presentation fields', async () => {
  const db = rankingDatabase();
  db.exec(`
    UPDATE sh_tracks SET title='曲名不明',artist='-' WHERE id=1;
    UPDATE sh_track_ranking_current
      SET title='曲名不明',artist='-' WHERE track_identity='track:1';
    UPDATE sh_track_ranking_occurrence
      SET title='曲名不明',artist='-' WHERE track_identity='track:1';
    INSERT INTO sh_track_dictionary(
      isrc,spotify_id,title,artist,thumbnail_url,metadata_fetched_at
    ) VALUES(
      'JPTEST1','sp1','Recovered title','櫻坂46','https://example.test/cover.jpg',4000
    );
  `);

  const result = await loadTrackRanking(d1Adapter(db), { limit: 500 });
  const row = result.rows.find((item) => item.track_identity === 'track:1');

  assert.equal(row.title, 'Recovered title');
  assert.equal(row.artist, '櫻坂46');
  assert.equal(row.thumbnail_url, 'https://example.test/cover.jpg');
  const track = db.prepare('SELECT title,artist FROM sh_tracks WHERE id=1').get();
  assert.equal(track.title, '曲名不明');
  assert.equal(track.artist, '-');
  const current = db.prepare(`SELECT title,artist FROM sh_track_ranking_current WHERE track_identity='track:1'`).get();
  assert.equal(current.title, '曲名不明');
  assert.equal(current.artist, '-');
  const occurrences = db.prepare(`SELECT DISTINCT title,artist FROM sh_track_ranking_occurrence WHERE track_identity='track:1'`).all();
  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].title, '曲名不明');
  assert.equal(occurrences[0].artist, '-');
});

test('track ranking recovers legacy key identifiers through canonical ISRC metadata and persists identifiers only', async () => {
  const db = rankingDatabase();
  db.exec(`
    INSERT INTO sh_track_ranking_current(
      track_identity,track_id,title,artist,isrc,spotify_id,
      latest_like_count,latest_observed_at,latest_occurrence_key
    ) VALUES(
      'key:isrc:JPOLD000001',NULL,'曲名不明','-',NULL,NULL,12,3500,'legacy-occ'
    );
    INSERT INTO sh_track_dictionary(
      isrc,spotify_id,title,artist,thumbnail_url,metadata_fetched_at
    ) VALUES(
      'JPOLD000001','sp-old','Recovered by ISRC','櫻坂46',NULL,3600
    );
  `);

  const result = await loadTrackRanking(d1Adapter(db), { limit: 500 });
  const row = result.rows.find((item) => item.track_identity === 'key:isrc:JPOLD000001');

  assert.equal(row.title, 'Recovered by ISRC');
  assert.equal(row.artist, '櫻坂46');
  assert.equal(row.spotify_id, 'sp-old');
  assert.equal(row.isrc, 'JPOLD000001');
  const persisted = db.prepare(`SELECT title,artist,isrc,spotify_id FROM sh_track_ranking_current
    WHERE track_identity='key:isrc:JPOLD000001'`).get();
  assert.equal(persisted.title, '曲名不明');
  assert.equal(persisted.artist, '-');
  assert.equal(persisted.isrc, 'JPOLD000001');
  assert.equal(persisted.spotify_id, 'sp-old');
});

test('FACTS schema publishes materialized cleanup and ranking state', () => {
  const purgeScript = readFileSync(
    new URL('../worker/scripts/purge-completed-minute-fact-payloads.mjs', import.meta.url),
    'utf8',
  );
  const descriptor = JSON.parse(readFileSync(
    new URL('../database/facts-db.json', import.meta.url),
    'utf8',
  ));
  assert.match(materializedMigration, /idx_sh_minute_fact_jobs_payload_clearable/);
  assert.match(materializedMigration, /CREATE TABLE IF NOT EXISTS sh_track_ranking_current/);
  assert.match(materializedMigration, /trg_sh_track_ranking_current_after_counter_update/);
  assert.match(purgeScript, /payload_clearable=1/);
  assert.match(purgeScript, /remainingEligibleJobId != null/);
  assert.doesNotMatch(purgeScript, /NOT EXISTS \(\s*SELECT 1 FROM sh_queue_revisions/);
  assert.equal(descriptor.schema, descriptor.migrations.at(-1));
  assert.equal(
    descriptor.migrations.includes('database/facts-migrations/032_materialized_cleanup_ranking.sql'),
    true,
  );
});
