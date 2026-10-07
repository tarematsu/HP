import assert from 'node:assert/strict';
import test from 'node:test';
import { coordinateOhisamaCollection, clearOhisamaPriorityRetry } from '../src/stationhead-collection-priority.js';
import { requireStationheadSourceProfile } from '../../packages/sh-shared/stationhead-source.mjs';
import { runOhisamaPagesScheduled } from '../src/ohisama-pages-entry.js';

const BASE = Date.UTC(2026, 9, 8, 12, 0);
const KEY = requireStationheadSourceProfile('ohisama').priorityRetryKey;

function fakeEnv() {
  const stored = new Map();
  const calls = [];
  let ready = true;
  return {
    calls,
    stored,
    setReady(next) { ready = next; },
    BUDDIES_COLLECTOR_COORDINATOR: {
      getByName(name) {
        assert.equal(name, 'scheduled-v1');
        return {
          async fetch(_, request) {
            const data = JSON.parse(request.body);
            assert.equal(data.action, 'status');
            assert.equal(data.minimumSuccessAt, BASE);
            calls.push(data);
            return Response.json({ ready, status: ready ? 'completed' : 'running',
              last_success_at: ready ? BASE : BASE - 300_000 });
          },
        };
      },
    },
    PAGES_RESPONSE_R2: {
      async get(key) {
        const body = stored.get(key);
        return body == null ? null : { json: async () => JSON.parse(body) };
      },
      async put(key, body) { stored.set(key, body); },
      async delete(key) { stored.delete(key); },
    },
  };
}

test('Buddies has the first Stationhead priority, Ohisama second', () => {
  const b = requireStationheadSourceProfile('buddies');
  const o = requireStationheadSourceProfile('ohisama');
  const n = requireStationheadSourceProfile('nogizaka');
  assert.deepEqual([b.collectionPriority, o.collectionPriority, n.collectionPriority], [0, 1, 2]);
});

test('Ohisama proceeds at +1 only after the correct Buddies five-minute checkpoint', async () => {
  const env = fakeEnv();
  assert.deepEqual(await coordinateOhisamaCollection(env, BASE + 60_000, { waitMs: 0 }),
    { skipped: false, reason: 'buddies-complete' });
  assert.equal(env.calls.length, 1);
  assert.equal(env.stored.size, 0);
  assert.deepEqual(await coordinateOhisamaCollection(env, BASE + 120_000),
    { skipped: true, reason: 'no-buddies-priority-retry' });
  assert.equal(env.calls.length, 1);
});

test('Ohisama yields to a busy Buddies collector, then retries at +2 exactly once', async () => {
  const env = fakeEnv();
  env.setReady(false);
  const first = await coordinateOhisamaCollection(env, BASE + 60_000, { waitMs: 0 });
  assert.equal(first.skipped, true);
  assert.equal(first.reason, 'waiting-for-buddies-priority');
  assert.equal(JSON.parse(env.stored.get(KEY)).slot_at, BASE);
  env.setReady(true);
  assert.deepEqual(await coordinateOhisamaCollection(env, BASE + 120_000, { waitMs: 0 }),
    { skipped: false, reason: 'buddies-complete' });
  assert.equal(await clearOhisamaPriorityRetry(env, BASE + 120_000), true);
  assert.equal(env.stored.size, 0);
  assert.equal((await coordinateOhisamaCollection(env, BASE + 120_000)).skipped, true);
});

test('an unresolved Buddies run takes precedence at both slots; stale markers never retry', async () => {
  const env = fakeEnv();
  env.setReady(false);
  await coordinateOhisamaCollection(env, BASE + 60_000, { waitMs: 0 });
  const result = await coordinateOhisamaCollection(env, BASE + 120_000, { waitMs: 0 });
  assert.equal(result.reason, 'buddies-priority-retry-exhausted');
  assert.equal((await coordinateOhisamaCollection(env, BASE + 5 * 60_000 + 120_000)).skipped, true);
});

test('Ohisama remains usable when the Buddies coordinator binding is absent during rollout', async () => {
  const env = fakeEnv();
  delete env.BUDDIES_COLLECTOR_COORDINATOR;
  assert.deepEqual(await coordinateOhisamaCollection(env, BASE + 60_000),
    { skipped: false, reason: 'buddies-coordinator-unavailable' });
});

test('Ohisama scheduled runner uses real collector and Read Model entry points', () => {
  const source = String(runOhisamaPagesScheduled);
  assert.match(source, /runOhisamaCollectorScheduled\(/);
  assert.match(source, /refreshOhisamaReadModel\(/);
  assert.doesNotMatch(source, /runOptimizedOhisamaCollectorScheduled|refreshOptimizedOhisamaReadModel/);
});
