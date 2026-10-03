import assert from 'node:assert/strict';
import test from 'node:test';

import {
  materializeTrackHistoryRangeThroughR2,
  PLAYBACK_EVENT_HISTORY_SQL,
} from '../src/pages-track-history-r2-shards.js';

class FakeR2 {
  constructor() {
    this.values = new Map();
  }

  async put(key, value) {
    this.values.set(key, String(value));
  }

  async get(key) {
    const value = this.values.get(key);
    if (value == null) return null;
    return {
      async json() { return JSON.parse(value); },
      async text() { return value; },
    };
  }
}

class FakeCatalogDb {
  prepare(sql) {
    return {
      sql,
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async all() { return { results: [] }; },
      async first() { return null; },
      async run() { return { meta: { changes: 0 } }; },
    };
  }
}

class FakePlaybackDb {
  constructor(rows) {
    this.rows = rows;
    this.calls = [];
  }

  prepare(sql) {
    assert.equal(sql, PLAYBACK_EVENT_HISTORY_SQL);
    const owner = this;
    return {
      args: [],
      bind(...args) {
        this.args = args;
        return this;
      },
      async all() {
        owner.calls.push(this.args);
        return { results: owner.rows };
      },
    };
  }
}

test('transition shard combines only the legacy prefix before the first exact playback event', async () => {
  const fromTs = Date.UTC(2026, 9, 1, 9);
  const eventStart = fromTs + 60 * 60_000;
  const toTs = fromTs + 3 * 60 * 60_000;
  const range = { fromTs, toTs };
  const r2 = new FakeR2();
  const sourceDb = new FakePlaybackDb([{
    play_date: '2026-10-01',
    track_id: 42,
    played_at: eventStart,
    first_played_at: eventStart,
    last_played_at: eventStart + 90 * 60_000,
    play_count: 3,
  }]);
  const loadCalls = [];

  const result = await materializeTrackHistoryRangeThroughR2(
    sourceDb,
    new FakeCatalogDb(),
    range,
    toTs,
    {
      r2,
      generation: toTs,
      cleanupDay: false,
      async loadData(_db, loadFrom, loadTo, _limit, includeLikes) {
        loadCalls.push({ from: loadFrom, to: loadTo, includeLikes });
        if (loadFrom === fromTs && loadTo === toTs) {
          return {
            result: { results: [{
              play_date: '2026-10-01',
              track_id: 42,
              play_count: 99,
              first_played_at: fromTs,
              last_played_at: toTs - 1,
              period_first_observed_at: fromTs,
              period_last_observed_at: toTs - 1,
            }] },
            likeRows: [],
          };
        }
        assert.equal(loadFrom, fromTs);
        assert.equal(loadTo, eventStart);
        assert.equal(includeLikes, false);
        return {
          result: { results: [{
            play_date: '2026-10-01',
            track_id: 42,
            play_count: 2,
            first_played_at: fromTs,
            last_played_at: eventStart - 1,
          }] },
          likeRows: [],
        };
      },
      attachLikes: (rows) => rows,
      applyCompleteness: (rows) => ({ rows, excludedDates: [] }),
    },
  );

  assert.deepEqual(loadCalls, [
    { from: fromTs, to: toTs, includeLikes: true },
    { from: fromTs, to: eventStart, includeLikes: false },
  ]);
  assert.equal(sourceDb.calls.length, 1);
  assert.equal(result.sourceRowCount, 5);
  const shard = [...r2.values.values()].map((value) => JSON.parse(value))
    .find((value) => Array.isArray(value.rows));
  assert.equal(shard.rows.length, 1);
  assert.equal(shard.rows[0].play_count, 5);
});
