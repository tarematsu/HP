import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readMinuteFactRuntimeState,
  recordMinuteFactRuntimeState,
} from '../src/minute-facts-runtime-state.js';
import { runCoreFetch } from '../src/runtime-orchestrator-entry.js';
import { RuntimeCoordinator } from '../src/runtime-orchestrator-deployed-entry.js';

function storage() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
  };
}

function coordinatorEnv(coordinator, db = null) {
  const stub = {
    fetch(request, init) {
      return coordinator.fetch(new Request(request, init));
    },
  };
  return {
    RUNTIME_STATE_DO_ENABLED: true,
    RUNTIME_COORDINATOR: { getByName() { return stub; } },
    MINUTE_DB: db || {
      prepare() { throw new Error('D1 runtime state must not be used'); },
    },
  };
}

test('runtime diagnostic counters are accumulated in the existing RuntimeCoordinator namespace', async () => {
  const durableStorage = storage();
  const coordinator = new RuntimeCoordinator({ storage: durableStorage }, {});
  const env = coordinatorEnv(coordinator);

  const first = await recordMinuteFactRuntimeState(env, 'derive', {
    processed: 3,
    failed: 0,
    pending_count: 2,
  }, { now: 100_000, startedAt: 99_000 });
  const second = await recordMinuteFactRuntimeState(env, 'derive', {
    processed: 2,
    failed: 1,
    pending_count: 1,
    error: new Error('derive failed'),
  }, { now: 101_000, startedAt: 100_500 });

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error, 'derive failed');

  const stored = await readMinuteFactRuntimeState(env, 'derive');
  assert.equal(stored.runs_total, 2);
  assert.equal(stored.succeeded_total, 1);
  assert.equal(stored.failed_total, 1);
  assert.equal(stored.processed_total, 5);
  assert.equal(stored.job_failures_total, 1);
  assert.equal(stored.pending_count, 1);
  assert.equal(stored.last_error, 'derive failed');

  const all = await readMinuteFactRuntimeState(env);
  assert.deepEqual(all.map(({ task_name }) => task_name), ['derive']);
  assert.equal(
    [...durableStorage.values.keys()].some((key) => key === 'runtime-state:task:derive'),
    true,
  );
});

test('an empty Durable Object state falls back to existing D1 diagnostics during migration', async () => {
  const durableStorage = storage();
  const coordinator = new RuntimeCoordinator({ storage: durableStorage }, {});
  const calls = [];
  const db = {
    prepare(sql) {
      calls.push(sql);
      return {
        bind() { return this; },
        async first() { return { task_name: 'derive', runs_total: 9, pending_count: 0 }; },
        async all() { return { results: [{ task_name: 'derive', runs_total: 9 }] }; },
      };
    },
  };
  const env = coordinatorEnv(coordinator, db);
  assert.equal((await readMinuteFactRuntimeState(env, 'derive')).runs_total, 9);
  assert.deepEqual(await readMinuteFactRuntimeState(env), [{ task_name: 'derive', runs_total: 9 }]);
  assert.equal(calls.length, 2);
});

test('runtime state falls back to D1 when the Durable Object request fails', async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      calls.push(sql);
      return {
        bind() { return this; },
        async run() { return { meta: { changes: 1 } }; },
        async first() { return { task_name: 'derive', pending_count: 0 }; },
        async all() { return { results: [] }; },
      };
    },
  };
  const env = {
    RUNTIME_STATE_DO_ENABLED: true,
    RUNTIME_COORDINATOR: {
      getByName() {
        return { async fetch() { throw new Error('DO unavailable'); } };
      },
    },
    MINUTE_DB: db,
  };

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (value) => warnings.push(String(value));
  try {
    await recordMinuteFactRuntimeState(env, 'derive', { processed: 1 }, { now: 200_000 });
    assert.equal((await readMinuteFactRuntimeState(env, 'derive')).task_name, 'derive');
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(calls.some((sql) => /INSERT INTO sh_minute_fact_runtime_state/.test(sql)), true);
  assert.equal(calls.some((sql) => /SELECT \* FROM sh_minute_fact_runtime_state/.test(sql)), true);
  assert.match(warnings.join('\n'), /runtime_state_do_(?:record|read)_failed/);
});

test('internal service endpoint exposes current Runtime Coordinator diagnostics', async () => {
  const response = await runCoreFetch(
    new Request('https://runtime.internal/internal/minute-runtime-state'),
    {},
    {},
    {
      async readMinuteRuntimeState() {
        return [{ task_name: 'derive', last_success_at: 123 }];
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()).tasks, [{
    task_name: 'derive',
    last_success_at: 123,
  }]);
});
