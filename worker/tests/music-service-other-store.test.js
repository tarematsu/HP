import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createAmazonMusicDbRouter,
  persistAmazonMusicModelToOther,
  persistAppleMusicModelToOther,
} from '../src/music-service-other-store.js';

function fakeDb(name) {
  const calls = [];
  const batches = [];
  const db = {
    name,
    calls,
    batches,
    prepare(sql) {
      const record = { db: name, sql: String(sql), values: [] };
      calls.push(record);
      const statement = {
        bind(...values) {
          record.values = values;
          return statement;
        },
        async run() { return { success: true }; },
        async all() { return { results: [] }; },
        async first() { return null; },
      };
      return statement;
    },
    async batch(statements) {
      batches.push(statements.length);
      return statements.map(() => ({ success: true }));
    },
  };
  return db;
}

function r2With(key, model) {
  return {
    async get(requested) {
      if (requested !== key) return null;
      return { async json() { return model; } };
    },
  };
}

test('Amazon DB router keeps identity SQL in minute and service facts in other', async () => {
  const minute = fakeDb('minute');
  const other = fakeDb('other');
  const db = createAmazonMusicDbRouter(minute, other);

  await db.prepare('SELECT id FROM sh_tracks WHERE isrc=?').bind('JPTEST000001').all();
  await db.prepare(`INSERT INTO amazon_music_chart_change_events
    (observed_at,chart_key,previous_hash,current_hash,changed_positions)
    VALUES (?,?,?,?,?)`).bind(1, 'chart', 'a', 'b', 1).run();

  assert.equal(minute.calls.length, 1);
  assert.match(minute.calls[0].sql, /sh_tracks/);
  assert.equal(other.calls.length, 1);
  assert.match(other.calls[0].sql, /amazon_music_chart_change_events/);
});

test('Amazon DB router splits mixed batches without changing result order', async () => {
  const minute = fakeDb('minute');
  const other = fakeDb('other');
  const db = createAmazonMusicDbRouter(minute, other);
  const minuteStatement = db.prepare('UPDATE sh_track_aliases SET last_seen_at=?').bind(1);
  const otherStatement = db.prepare('INSERT INTO amazon_music_group_rank_history VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(1, '櫻坂46', 'A', 2, 3, null, 'enter', 'Song', '櫻坂46');
  const results = await db.batch([minuteStatement, otherStatement]);
  assert.equal(results.length, 2);
  assert.deepEqual(minute.batches, [1]);
  assert.deepEqual(other.batches, [1]);
});

test('legacy Apple model persists canonical ranks with an explicit primary artist key', async () => {
  const db = fakeDb('other');
  const model = {
    snapshot_date: '2026-09-30',
    observed_at: 1000,
    regions: [{
      code: 'jp',
      tracks: [
        { apple_music_id: 'APPLE1', track_id: 41, rank: 1 },
        { apple_music_id: 'APPLE2', track_id: null, rank: 2 },
      ],
    }],
  };
  const result = await persistAppleMusicModelToOther({
    OTHER_DB: db,
    PAGES_RESPONSE_R2: r2With('apple-music/read-model/latest.json', model),
  }, 1000);

  assert.equal(result.persisted, true);
  assert.equal(result.refs, 1);
  assert.equal(result.snapshots, 1);
  const ref = db.calls.find((call) => call.sql.includes('music_service_track_refs'));
  assert.deepEqual(ref.values.slice(0, 3), ['apple_music', 'APPLE1', 41]);
  const snapshot = db.calls.find((call) => call.sql.includes('apple_music_rank_snapshots'));
  assert.equal(snapshot.values[0], '2026-09-30');
  assert.deepEqual(JSON.parse(snapshot.values[3]), [
    { artist_key: 'sakurazaka46', track_id: 41, rank: 1 },
  ]);
});

test('combined Apple model persists all three artists and uses the newest artist snapshot date', async () => {
  const db = fakeDb('other');
  const model = {
    snapshot_date: '2026-09-30',
    observed_at: 1000,
    artists: [
      {
        key: 'sakurazaka46',
        snapshot_date: '2026-09-30',
        observed_at: 1000,
        regions: [{ code: 'jp', tracks: [{ apple_music_id: 'SAKU1', track_id: 41, rank: 1 }] }],
      },
      {
        key: 'nogizaka46',
        snapshot_date: '2026-10-02',
        observed_at: 3000,
        regions: [{ code: 'jp', tracks: [{ apple_music_id: 'NOGI1', track_id: 51, rank: 2 }] }],
      },
      {
        key: 'hinatazaka46',
        snapshot_date: '2026-10-01',
        observed_at: 2000,
        regions: [{ code: 'jp', tracks: [{ apple_music_id: 'HINA1', track_id: 61, rank: 3 }] }],
      },
    ],
  };
  const result = await persistAppleMusicModelToOther({
    OTHER_DB: db,
    PAGES_RESPONSE_R2: r2With('apple-music/read-model/latest.json', model),
  }, 2500);

  assert.equal(result.persisted, true);
  assert.equal(result.refs, 3);
  assert.equal(result.snapshots, 1);
  assert.equal(result.snapshot_date, '2026-10-02');
  const refs = db.calls.filter((call) => call.sql.includes('music_service_track_refs'));
  assert.deepEqual(refs.map((call) => call.values.slice(0, 3)), [
    ['apple_music', 'SAKU1', 41],
    ['apple_music', 'NOGI1', 51],
    ['apple_music', 'HINA1', 61],
  ]);
  const snapshot = db.calls.find((call) => call.sql.includes('apple_music_rank_snapshots'));
  assert.equal(snapshot.values[0], '2026-10-02');
  assert.equal(snapshot.values[2], 3000);
  assert.deepEqual(JSON.parse(snapshot.values[3]), [
    { artist_key: 'hinatazaka46', track_id: 61, rank: 3 },
    { artist_key: 'nogizaka46', track_id: 51, rank: 2 },
    { artist_key: 'sakurazaka46', track_id: 41, rank: 1 },
  ]);
});

test('Amazon completed model preserves provider editions independently of canonical song ID', async () => {
  const db = fakeDb('other');
  const model = {
    snapshot_date: '2026-09-30',
    observed_at: 2000,
    scan: { complete: true },
    tracks: [
      { amazon_music_id: 'AMZ_STANDARD', track_id: 51, amazon_rank: 12 },
      { amazon_music_id: 'AMZ_SPECIAL', track_id: 51, amazon_rank: 34 },
      { amazon_music_id: 'AMZ_UNRANKED', track_id: 52, amazon_rank: null },
      { amazon_music_id: 'AMZ_UNRESOLVED', track_id: null, amazon_rank: 45 },
    ],
  };
  const result = await persistAmazonMusicModelToOther({
    OTHER_DB: db,
    PAGES_RESPONSE_R2: r2With('amazon-music/read-model/latest.json', model),
  }, 2000);

  assert.equal(result.persisted, true);
  assert.equal(result.refs, 3);
  assert.equal(result.ranked_tracks, 3);
  const refCalls = db.calls.filter((call) => call.sql.includes('music_service_track_refs'));
  assert.deepEqual(refCalls.map((call) => call.values.slice(0, 3)), [
    ['amazon_music', 'AMZ_STANDARD', 51],
    ['amazon_music', 'AMZ_SPECIAL', 51],
    ['amazon_music', 'AMZ_UNRANKED', 52],
  ]);
  const snapshot = db.calls.find((call) => call.sql.includes('amazon_music_rank_snapshots'));
  assert.deepEqual(JSON.parse(snapshot.values[2]), [
    { source_track_id: 'AMZ_STANDARD', track_id: 51, rank: 12 },
    { source_track_id: 'AMZ_SPECIAL', track_id: 51, rank: 34 },
    { source_track_id: 'AMZ_UNRESOLVED', track_id: null, rank: 45 },
  ]);
});

test('other DB migration makes sh_tracks.id the shared service reference', () => {
  const migration = readFileSync(
    new URL('../../database/other-migrations/059_music_service_canonical_refs.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS music_service_track_refs/);
  assert.match(migration, /CHECK\(service IN \('apple_music','amazon_music','spotify'\)\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS apple_music_rank_snapshots/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS amazon_music_rank_snapshots/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS amazon_music_chart_change_events/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS amazon_music_group_rank_history/);
  assert.match(migration, /SELECT\s+'spotify',source_track_id,stationhead_track_id/s);
  assert.match(migration, /CREATE TRIGGER trg_spotify_track_ref_insert/);
  assert.match(migration, /CREATE TRIGGER trg_spotify_track_ref_update/);
});
