import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readStationheadCollectorD1State,
  stationheadCollectorCheckpointStatement,
  persistStationheadCollectorD1Credentials,
  recordStationheadCollectorD1Failure,
} from '../src/stationhead-collector-state-d1.js';

function stubDb(rows = {}) {
  const operations = [];
  return {
    operations,
    prepare(sql) {
      return {
        bind(...params) {
          const operation = { sql, params };
          operations.push(operation);
          return {
            async run() { return { meta: { changes: 1 } }; },
            async first() { return rows[params[0]] ?? null; },
          };
        },
      };
    },
  };
}

test('collector state reader is restricted to requested source-owned D1 binding and state id', async () => {
  const record = { auth_token: 'token-one', device_uid: 'device-one', updated_at: 123 };
  const buddies = stubDb({ stationhead: record });
  const ohisama = stubDb();
  assert.equal(await readStationheadCollectorD1State(buddies), record);
  assert.equal(await readStationheadCollectorD1State(ohisama), null);
  assert.deepEqual(buddies.operations[0].params, ['stationhead']);
  assert.equal(buddies.operations[0].sql.includes('WHERE id=? LIMIT 1'), true);
  assert.equal(ohisama.operations.length, 1);
  assert.equal(buddies.operations.length, 1);
});

test('Buddies authentication refresh updates only credentials, leaving collector checkpoint intact', async () => {
  const db = stubDb();
  await persistStationheadCollectorD1Credentials(db, {
    authToken: 'new-token', deviceUid: 'device', tokenExpiresAt: 180_000,
  }, 123_456);
  assert.deepEqual(db.operations[0].params, ['stationhead', 'new-token', 'device', 180_000, 123_456]);
  assert.doesNotMatch(db.operations[0].sql, /last_success_at=excluded|last_error=excluded/);
  assert.equal(db.operations.length, 1);
});

test('Ohisama full collector checkpoint retains existing success and cleared error semantics', async () => {
  const db = stubDb();
  const state = {
    authToken: 'token-two', deviceUid: 'uid-two', tokenExpiresAt: 100_000,
    lastRunAt: 30, lastSuccessAt: 30, lastError: 'previous failure',
    lastChannelId: 46, lastStationId: 789,
  };
  const stmt = stationheadCollectorCheckpointStatement(db, state, 35);
  await stmt.run();
  const { sql, params } = db.operations[0];
  assert.deepEqual(params, ['stationhead','token-two','uid-two',100_000,30,30,null,46,789,35]);
  assert.match(sql, /ON CONFLICT\(id\) DO UPDATE SET/);
  assert.match(sql, /last_success_at=excluded\.last_success_at/);
  assert.match(sql, /last_error=excluded\.last_error/);
  assert.equal(db.operations.length, 1);
});

test('collector failure checkpoint changes failure fields but never overwrites auth credentials', async () => {
  const db = stubDb();
  await recordStationheadCollectorD1Failure(db, 99, 'API 503');
  const { sql, params } = db.operations[0];
  assert.deepEqual(params, ['stationhead',99,'API 503',99]);
  assert.match(sql, /last_error=excluded\.last_error/);
  assert.doesNotMatch(sql, /auth_token=excluded|device_uid=excluded/);
  assert.equal(db.operations.length, 1);
});

test('unavailable D1 binding fails closed in shared collector state operations', async () => {
  await assert.rejects(readStationheadCollectorD1State(null), /D1 binding is missing/);
  await assert.rejects(persistStationheadCollectorD1Credentials(null, {}, 1), /D1 binding is missing/);
  await assert.rejects(recordStationheadCollectorD1Failure(null, 1, 'error'), /D1 binding is missing/);
  assert.throws(() => stationheadCollectorCheckpointStatement(null, {}, 1), /D1 binding is missing/);
});
