import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  RuntimeCoordinator,
  runFetchCoordinatedScheduled,
} from '../src/runtime-orchestrator-deployed-entry.js';

function storage() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
  };
}

test('production direct mode executes one scheduled graph inside the Durable Object', async () => {
  const actions = [];
  let directCalls = 0;
  const result = await runFetchCoordinatedScheduled({
    cron: '* * * * *',
    scheduledTime: 120_000,
  }, {
    RUNTIME_COORDINATOR_DIRECT_RUN_ENABLED: true,
  }, {}, {
    stub: {
      async fetch(_url, init) {
        const body = JSON.parse(init.body);
        actions.push(body);
        return Response.json({ runtime: 'inside-do', pages: 'inside-do' });
      },
    },
    async runDirect() {
      directCalls += 1;
      return { runtime: 'outside-do' };
    },
  });

  assert.equal(directCalls, 0);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].action, 'run');
  assert.equal(actions[0].scheduledTime, 120_000);
  assert.deepEqual(result, { runtime: 'inside-do', pages: 'inside-do' });
});

test('direct mode retries the same ticket without running the Worker fallback', async () => {
  const actions = [];
  let attempts = 0;
  let directCalls = 0;
  const result = await runFetchCoordinatedScheduled({
    cron: '* * * * *',
    scheduledTime: 180_000,
  }, {
    RUNTIME_COORDINATOR_DIRECT_RUN_ENABLED: true,
    RUNTIME_COORDINATOR_FAIL_OPEN: false,
  }, {}, {
    stub: {
      async fetch(_url, init) {
        actions.push(JSON.parse(init.body));
        attempts += 1;
        if (attempts === 1) throw new Error('response lost');
        return Response.json({ skipped: true, reason: 'runtime-coordinator-duplicate' });
      },
    },
    async runDirect() { directCalls += 1; },
  });

  assert.equal(attempts, 2);
  assert.equal(directCalls, 0);
  assert.deepEqual(actions[0], actions[1]);
  assert.deepEqual(result, { skipped: true, reason: 'runtime-coordinator-duplicate' });
});

test('RuntimeCoordinator runs the graph once and releases its local lease', async () => {
  const durableStorage = storage();
  const calls = [];
  const coordinator = new RuntimeCoordinator({ storage: durableStorage }, {}, {
    async runDirect(controller, env) {
      calls.push({ controller, lock: env.PRIMARY_RUN_LOCK_ENABLED });
      return { runtime: 'ok', pages: 'ok' };
    },
  });
  const request = () => new Request('https://internal/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'run',
      cron: '* * * * *',
      scheduledTime: 240_000,
      leaseMs: 70_000,
    }),
  });

  const first = await coordinator.fetch(request());
  assert.equal(first.status, 200);
  assert.equal((await first.json()).runtime, 'ok');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lock, false);

  const duplicate = await coordinator.fetch(request());
  assert.equal((await duplicate.json()).reason, 'runtime-coordinator-duplicate');
  assert.equal(calls.length, 1);
});

test('runtime configuration enables DO execution and fail-closed delivery', () => {
  const config = JSON.parse(readFileSync(
    new URL('../wrangler.runtime.jsonc', import.meta.url),
    'utf8',
  ));
  assert.equal(config.vars.RUNTIME_COORDINATOR_DIRECT_RUN_ENABLED, true);
  assert.equal(config.vars.RUNTIME_COORDINATOR_FAIL_OPEN, false);
});
