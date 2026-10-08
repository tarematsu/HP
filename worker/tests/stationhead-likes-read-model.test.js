import assert from 'node:assert/strict';
import test from 'node:test';

import {
  publishStationheadLikesReadModel,
  stationheadLikeRanking,
  stationheadLikesModelKey,
} from '../src/stationhead-likes-read-model.js';

class FakeR2 {
  constructor() { this.values = new Map(); this.puts = []; }
  async get(key) {
    const entry = this.values.get(key);
    if (!entry) return null;
    return {
      body: entry.body,
      customMetadata: entry.options?.customMetadata || {},
      writeHttpMetadata() {},
    };
  }
  async put(key, body, options = {}) {
    this.puts.push(key);
    this.values.set(key, { body, options });
  }
}

test('Stationhead likes ranking is canonical and sorted by latest count', () => {
  const ranking = stationheadLikeRanking({
    '2': { track_id: 2, title: 'B', artist: '日向坂46', like_count: 12, observed_at: 200 },
    '1': { track_id: 1, title: 'A', artist: '日向坂46', like_count: 20, observed_at: 100 },
  });
  assert.deepEqual(ranking.map((row) => [row.track_id, row.like_count]), [[1, 20], [2, 12]]);
});

test('likes model keys use canonical Stationhead sources and reject unknown names', () => {
  assert.equal(stationheadLikesModelKey('ohisama'), 'track-likes:ohisama');
  assert.equal(stationheadLikesModelKey('Hinata'), 'track-likes:ohisama');
  assert.equal(stationheadLikesModelKey('NOGIZAKA46SMEJ'), 'track-likes:nogizaka');
  assert.equal(stationheadLikesModelKey('unknown'), null);
});

test('source-scoped likes read model writes canonical R2 only at its cadence', async () => {
  const r2 = new FakeR2();
  const key = stationheadLikesModelKey('ohisama');
  const likes = {
    '1': { track_id: 1, title: 'A', artist: '日向坂46', like_count: 20, observed_at: 100 },
  };
  const first = await publishStationheadLikesReadModel(r2, 'ohisama', likes, 1_000, { cadenceMs: 6 * 60 * 60_000 });
  assert.equal(first.published, true);
  assert.deepEqual(r2.puts, [expectKey(key)]);

  const second = await publishStationheadLikesReadModel(r2, 'ohisama', likes, 2_000, { cadenceMs: 6 * 60 * 60_000 });
  assert.equal(second.published, false);
  assert.equal(second.reason, 'cadence');
  assert.equal(r2.puts.length, 1);

  const changed = {
    '1': { track_id: 1, title: 'A', artist: '日向坂46', like_count: 21, observed_at: 3_000 },
  };
  const third = await publishStationheadLikesReadModel(r2, 'ohisama', changed, 3_000, { cadenceMs: 6 * 60 * 60_000 });
  assert.equal(third.published, true);
  assert.equal(third.reason, 'updated');
  assert.equal(r2.puts.length, 2);
  assert.equal(third.payload.ranking[0].like_count, 21);
});

test('source-scoped likes read model replaces an empty ranking immediately', async () => {
  const r2 = new FakeR2();
  const empty = await publishStationheadLikesReadModel(r2, 'ohisama', {}, 1_000, { cadenceMs: 6 * 60 * 60_000 });
  assert.equal(empty.published, true);
  assert.equal(empty.payload.ranking.length, 0);

  const populated = await publishStationheadLikesReadModel(r2, 'ohisama', {
    '7': { track_id: 7, title: 'New', artist: '日向坂46', like_count: 4, observed_at: 2_000 },
  }, 2_000, { cadenceMs: 6 * 60 * 60_000 });
  assert.equal(populated.published, true);
  assert.equal(populated.reason, 'updated');
  assert.equal(populated.payload.ranking.length, 1);
  assert.equal(r2.puts.length, 2);
});

function expectKey(modelKey) {
  return `pages-response/v1/${encodeURIComponent(modelKey)}.json`;
}

test('stale likes observations never replace a newer ranking, even when the content differs', async () => {
  const r2 = new FakeR2();
  await publishStationheadLikesReadModel(r2, 'ohisama', {
    '1': { track_id: 1, title: 'Current', like_count: 24, observed_at: 3_000 },
  }, 3_000);
  const older = await publishStationheadLikesReadModel(r2, 'ohisama', {
    '1': { track_id: 1, title: 'Old', like_count: 10, observed_at: 2_000 },
  }, 2_000);

  assert.equal(older.published, false);
  assert.equal(older.reason, 'stale-observation');
  assert.equal(r2.puts.length, 1);
  assert.equal(JSON.parse(r2.values.get(expectKey(stationheadLikesModelKey('ohisama'))).body)
    .ranking[0].like_count, 24);
});

test('transient likes R2 read failure does not allow an unverified overwrite', async () => {
  const r2 = new FakeR2();
  r2.get = async () => { throw new Error('temporary R2 read outage'); };
  await assert.rejects(
    publishStationheadLikesReadModel(r2, 'ohisama', {
      '1': { track_id: 1, like_count: 10, observed_at: 2_000 },
    }, 2_000),
    /temporary R2 read outage/,
  );
  assert.equal(r2.puts.length, 0);
});
