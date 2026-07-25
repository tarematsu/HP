import assert from 'node:assert/strict';
import test from 'node:test';

import { readAuthState } from '../src/auth-state.js';
import {
  collectorCachedDb,
  resetCollectorD1CacheForTests,
} from '../src/collector-d1-cache.js';
import { withCollectorDoHotState } from '../src/collector-do-hot-state.js';
import {
  collectorStateFromAuthState,
  saveCollectorStateAndClearFailure,
} from '../src/collector-state.js';

// These contracts keep DO as the minute-to-minute state layer while retaining
// D1 as the bounded recovery checkpoint and invalidating cached D1 reads safely.

function durableStorage() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
  };
}

function fakeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        async first() {
          calls.push({ method: 'first', sql, params: this.params });
          return {
            structural_hash: 'structure-1',
            likes_hash: 'likes-1',
            start_time: 1,
            observed_at: 100,
            latest_reachability_at: 100,
          };
        },
        async run() {
          calls.push({ method: 'run', sql, params: this.params });
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  };
}

function collectorDb(onWrite) {
  return {
    prepare() {
      return {
        bind() { return this; },
        async run() { onWrite(); return { meta: { changes: 1 } }; },
      };
    },
  };
}

const QUEUE_CURRENT_SQL = `SELECT current.structural_hash,current.likes_hash,
  current.start_time,current.observed_at,
  COALESCE((SELECT MAX(snapshot.observed_at) FROM sh_queue_snapshots snapshot
    WHERE snapshot.station_id IS current.station_id),0) AS latest_reachability_at
  FROM sh_queue_current current WHERE current.station_id IS ?`;

test('D1 hot rows survive Worker memory eviction in Durable Object storage', async () => {
  const storage = durableStorage();
  const db = fakeDb();
  const env = withCollectorDoHotState({
    COLLECTOR_DO_HOT_STATE_ENABLED: true,
    COLLECTOR_D1_QUEUE_CURRENT_CACHE_MS: 3_600_000,
  }, storage);

  let cached = collectorCachedDb(db, env);
  assert.equal((await cached.prepare(QUEUE_CURRENT_SQL).bind(7).first()).structural_hash, 'structure-1');
  assert.equal(db.calls.filter(({ method }) => method === 'first').length, 1);

  resetCollectorD1CacheForTests(db);
  cached = collectorCachedDb(db, env);
  assert.equal((await cached.prepare(QUEUE_CURRENT_SQL).bind(7).first()).structural_hash, 'structure-1');
  assert.equal(db.calls.filter(({ method }) => method === 'first').length, 1);
});

test('D1 writes advance the Durable Object cache generation', async () => {
  const storage = durableStorage();
  const db = fakeDb();
  const env = withCollectorDoHotState({ COLLECTOR_DO_HOT_STATE_ENABLED: true }, storage);
  let cached = collectorCachedDb(db, env);
  await cached.prepare(QUEUE_CURRENT_SQL).bind(7).first();
  await cached.prepare(`UPDATE sh_queue_current SET observed_at=? WHERE station_id=?`)
    .bind(200, 7).run();

  resetCollectorD1CacheForTests(db);
  cached = collectorCachedDb(db, env);
  await cached.prepare(QUEUE_CURRENT_SQL).bind(7).first();
  assert.equal(db.calls.filter(({ method }) => method === 'first').length, 2);
});

test('auth state is served from Durable Object without a D1 query', async () => {
  const storage = durableStorage();
  const expires = Date.now() + 8 * 60 * 60_000;
  storage.values.set('collector:hot:auth:stationhead', {
    id: 'stationhead',
    authToken: 'Bearer token',
    deviceUid: 'device',
    tokenExpiresAt: expires,
    controlExists: true,
    collectorLastRunAt: 100,
    collectorCheckpointAt: 50,
  });
  const env = withCollectorDoHotState({
    AUTH_REFRESH_BEFORE_MS: 3_600_000,
    DB: { prepare() { throw new Error('D1 auth read must not run'); } },
  }, storage);
  const state = await readAuthState(env);
  assert.equal(state.deviceUid, 'device');
  assert.equal(state.collectorLastRunAt, 100);
  assert.equal(state.collectorCheckpointAt, 50);
});

test('minute collector progress writes to Durable Object before the D1 checkpoint', async () => {
  const storage = durableStorage();
  let d1Writes = 0;
  const env = withCollectorDoHotState({
    DB: collectorDb(() => { d1Writes += 1; }),
    __shPersistCollectorCredentials: false,
  }, storage);
  const state = collectorStateFromAuthState({
    authToken: 'Bearer token',
    deviceUid: 'device',
    tokenExpiresAt: Date.now() + 8 * 60 * 60_000,
    collectorLastRunAt: 1_000_000,
    collectorCheckpointAt: 1_000_000,
    collectorLastSuccessAt: 1_000_000,
    collectorChannelId: 1,
    collectorStationId: 2,
  }, env);
  await saveCollectorStateAndClearFailure(env, state, {
    lastRunAt: 1_060_000,
    lastSuccessAt: 1_060_000,
  });
  assert.equal(d1Writes, 0);
  const hot = storage.values.get('collector:hot:auth:stationhead');
  assert.equal(hot.collectorLastRunAt, 1_060_000);
  assert.equal(hot.collectorCheckpointAt, 1_000_000);
  assert.equal(hot.collectorStationId, 2);
});

test('twenty-minute progress creates a D1 checkpoint and advances its DO marker', async () => {
  const storage = durableStorage();
  let d1Writes = 0;
  const env = withCollectorDoHotState({
    DB: collectorDb(() => { d1Writes += 1; }),
    __shPersistCollectorCredentials: false,
  }, storage);
  const state = collectorStateFromAuthState({
    authToken: 'Bearer token',
    deviceUid: 'device',
    tokenExpiresAt: Date.now() + 8 * 60 * 60_000,
    collectorLastRunAt: 2_140_000,
    collectorCheckpointAt: 1_000_000,
    collectorLastSuccessAt: 2_140_000,
    collectorChannelId: 1,
    collectorStationId: 2,
  }, env);
  await saveCollectorStateAndClearFailure(env, state, {
    lastRunAt: 2_200_000,
    lastSuccessAt: 2_200_000,
  });
  assert.equal(d1Writes, 1);
  const hot = storage.values.get('collector:hot:auth:stationhead');
  assert.equal(hot.collectorCheckpointAt, 2_200_000);
});
