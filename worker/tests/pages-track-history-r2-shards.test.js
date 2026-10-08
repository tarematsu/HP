import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadTrackHistoryDayReadModel,
  materializeTrackHistoryRangeThroughR2,
  PLAYBACK_EVENT_HISTORY_SQL,
  trackHistoryDayShardRanges,
} from '../src/pages-track-history-r2-shards.js';

const DAY_START = Date.UTC(2026, 6, 23);

class FakeR2 {
  constructor() {
    this.values = new Map();
    this.puts = 0;
    this.gets = 0;
  }

  async put(key, value) {
    this.puts += 1;
    this.values.set(key, String(value));
  }

  async get(key) {
    this.gets += 1;
    const value = this.values.get(key);
    if (value == null) return null;
    return {
      async json() { return JSON.parse(value); },
      async text() { return value; },
    };
  }
}

class FakeDb {
  constructor() {
    this.batches = [];
    this.deletes = [];
    this.selects = [];
  }

  prepare(sql) {
    const statement = {
      sql,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      all: async () => {
        this.selects.push(statement);
        return { results: [] };
      },
      run: async () => {
        this.deletes.push(statement);
        return { meta: { changes: 1 } };
      },
    };
    statement.deletes = this.deletes;
    return statement;
  }

  async batch(statements) {
    this.batches.push(statements);
    return statements.map(() => ({ success: true }));
  }
}

class FakePlaybackDb {
  constructor(rows = []) {
    this.rows = rows;
    this.selects = [];
  }

  prepare(sql) {
    assert.equal(sql, PLAYBACK_EVENT_HISTORY_SQL);
    const owner = this;
    const statement = {
      sql,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async all() {
        owner.selects.push(statement);
        return { results: owner.rows };
      },
    };
    return statement;
  }
}

function merged(rows) {
  if (!rows.length) return [];
  return [{
    ...rows[0],
    play_count: rows.reduce((sum, row) => sum + Number(row.play_count || 0), 0),
    first_played_at: Math.min(...rows.map((row) => Number(row.first_played_at))),
    last_played_at: Math.max(...rows.map((row) => Number(row.last_played_at))),
  }];
}

function dependencies(range) {
  return {
    async loadData(db) {
      assert.ok(db?.prepare, 'compact MINUTE_DB must be used as the legacy source');
      return {
        result: {
          results: [{
            play_date: '2026-07-23',
            spotify_id: 'track-1',
            title: 'Track 1',
            artist: 'Artist',
            play_count: 1,
            first_played_at: range.fromTs,
            last_played_at: range.toTs - 1,
          }],
        },
        likeRows: [],
      };
    },
    mergeRows: merged,
    attachLikes: (rows) => rows,
    applyCompleteness: (rows) => ({ rows, excludedDates: [] }),
  };
}

test('grouped history rows and like rows share one canonical lookup pass', async () => {
  const r2 = new FakeR2();
  const db = new FakeDb();
  const sourceDb = new FakePlaybackDb();
  const range = { fromTs: DAY_START, toTs: DAY_START + 3 * 60 * 60_000 };
  await materializeTrackHistoryRangeThroughR2(
    sourceDb,
    db,
    range,
    DAY_START,
    {
      r2,
      generation: DAY_START,
      cleanupDay: false,
      async loadData() {
        return {
          result: { results: [{
            play_date: '2026-07-23',
            spotify_id: 'shared-track',
            title: 'Shared Track',
            artist: 'Artist',
            play_count: 1,
            first_played_at: range.fromTs,
            last_played_at: range.toTs - 1,
          }] },
          likeRows: [{ spotify_id: 'shared-track', like_count: 12 }],
        };
      },
      mergeRows: (rows) => rows,
      attachLikes: (rows) => rows,
      applyCompleteness: (rows) => ({ rows, excludedDates: [] }),
    },
  );

  assert.equal(sourceDb.selects.length, 1);
  const spotifyIdentitySelects = db.selects.filter(({ sql }) => /FROM sh_tracks WHERE spotify_id IN/.test(sql));
  assert.equal(spotifyIdentitySelects.length, 1);
  assert.match(spotifyIdentitySelects[0].sql, /SELECT id AS track_id,spotify_id AS alias_value/);
  assert.deepEqual(spotifyIdentitySelects[0].args, ['shared-track']);
});

test('Buddies playback events replace legacy reconstructed play counts when available', async () => {
  const r2 = new FakeR2();
  const db = new FakeDb();
  const range = { fromTs: DAY_START, toTs: DAY_START + 3 * 60 * 60_000 };
  const sourceDb = new FakePlaybackDb([{
    play_date: '2026-07-23',
    track_id: 42,
    played_at: range.fromTs,
    first_played_at: range.fromTs,
    last_played_at: range.fromTs + 7 * 60_000,
    play_count: 3,
  }]);
  const legacyRows = [{
    play_date: '2026-07-23',
    track_id: 42,
    play_count: 1,
    first_played_at: range.fromTs,
    last_played_at: range.toTs - 1,
    period_first_observed_at: DAY_START + 5 * 60_000,
    period_last_observed_at: DAY_START + 24 * 60 * 60_000 - 5 * 60_000,
  }];
  let completenessCoverage = null;

  const result = await materializeTrackHistoryRangeThroughR2(
    sourceDb,
    db,
    range,
    DAY_START,
    {
      r2,
      generation: DAY_START,
      cleanupDay: false,
      async loadData() {
        return { result: { results: legacyRows }, likeRows: [] };
      },
      mergeRows: (rows) => rows,
      attachLikes: (rows) => rows,
      applyCompleteness(rows, coverageRows) {
        completenessCoverage = coverageRows;
        return { rows, excludedDates: [] };
      },
    },
  );

  assert.equal(result.sourceRowCount, 3);
  assert.equal(result.stagedRows, 1);
  assert.equal(sourceDb.selects.length, 1);
  assert.deepEqual(sourceDb.selects[0].args, ['2026-07-23', range.fromTs, range.toTs, 40_000]);
  assert.equal(completenessCoverage, legacyRows);
  const shard = [...r2.values.values()].map((value) => JSON.parse(value))
    .find((value) => Array.isArray(value.rows));
  assert.equal(shard.rows[0].play_count, 3);
});

test('explicit maintenance keeps staging shards in R2 and writes a stable R2 day model', async () => {
  const r2 = new FakeR2();
  const db = new FakeDb();
  const sourceDb = new FakePlaybackDb();
  const ranges = trackHistoryDayShardRanges({ fromTs: DAY_START, toTs: DAY_START + 3 * 60 * 60_000 });
  assert.equal(ranges.length, 8);

  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const result = await materializeTrackHistoryRangeThroughR2(
      sourceDb,
      db,
      range,
      DAY_START + index,
      {
        ...dependencies(range),
        r2,
        generation: DAY_START,
        cleanupDay: index === ranges.length - 1,
      },
    );
    if (index < ranges.length - 1) {
      assert.equal(result.storage, 'r2-shard');
      assert.equal(db.batches.length, 0);
    } else {
      assert.equal(result.storage, 'r2-day');
      assert.equal(result.rows, 1);
      assert.equal(result.stagedRows, 8);
    }
  }

  const day = await loadTrackHistoryDayReadModel(r2, '2026-07-23');
  assert.equal(day.payload.rows.length, 1);
  assert.equal(day.payload.rows[0].play_count, 8);
  assert.equal(r2.puts, 10);
  assert.equal(r2.gets, 10);
  assert.equal(db.batches.length, 0);
  assert.equal(db.deletes.length, 0);
  assert.equal(sourceDb.selects.length, 8);
});