import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  RuntimeCoordinator,
  runFetchCoordinatedScheduled,
  runRuntimeOrchestratorScheduled,
  runtimeOrchestratorDue,
} from '../src/runtime-orchestrator-deployed-entry.js';

const MINUTE_MS = 60_000;

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

test('direct mode retries the same ticket after a transport failure', async () => {
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

test('direct mode does not retry an HTTP execution failure as a duplicate success', async () => {
  let attempts = 0;
  let directCalls = 0;
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(runFetchCoordinatedScheduled({
      cron: '* * * * *',
      scheduledTime: 210_000,
    }, {
      RUNTIME_COORDINATOR_DIRECT_RUN_ENABLED: true,
      RUNTIME_COORDINATOR_FAIL_OPEN: false,
    }, {}, {
      stub: {
        async fetch() {
          attempts += 1;
          return new Response('runtime graph failed', { status: 500 });
        },
      },
      async runDirect() { directCalls += 1; },
    }), /runtime coordinator HTTP 500/);
  } finally {
    console.error = originalError;
  }
  assert.equal(attempts, 1);
  assert.equal(directCalls, 0);
});

test('production direct mode requires the Durable Object binding unless fail-open is explicit', async () => {
  let directCalls = 0;
  await assert.rejects(runFetchCoordinatedScheduled({
    cron: '* * * * *',
    scheduledTime: 220_000,
  }, {
    RUNTIME_COORDINATOR_DIRECT_RUN_ENABLED: true,
    RUNTIME_COORDINATOR_FAIL_OPEN: false,
  }, {}, {
    async runDirect() { directCalls += 1; },
  }), /binding is unavailable in direct mode/);
  assert.equal(directCalls, 0);

  const fallback = await runFetchCoordinatedScheduled({
    cron: '* * * * *',
    scheduledTime: 221_000,
  }, {
    RUNTIME_COORDINATOR_DIRECT_RUN_ENABLED: true,
    RUNTIME_COORDINATOR_FAIL_OPEN: true,
  }, {}, {
    async runDirect() { directCalls += 1; return 'fallback'; },
  });
  assert.equal(fallback, 'fallback');
  assert.equal(directCalls, 1);
});

test('production due gate enters the Durable Object only on 652 active minutes per UTC day', async () => {
  const day = Date.UTC(2026, 0, 1);
  const env = {
    RUNTIME_COORDINATOR_DIRECT_RUN_ENABLED: true,
    PAGES_TRACK_HISTORY_CYCLE_ENABLED: false,
    MINUTE_FACT_REPAIR_BURST_ENABLED: false,
  };
  let due = 0;
  for (let minute = 0; minute < 24 * 60; minute += 1) {
    if (runtimeOrchestratorDue({
      cron: '* * * * *',
      scheduledTime: day + minute * MINUTE_MS,
    }, env)) due += 1;
  }
  assert.equal(due, 652);

  let requests = 0;
  const idle = await runRuntimeOrchestratorScheduled({
    cron: '* * * * *',
    scheduledTime: day + 2 * MINUTE_MS,
  }, env, {}, {
    stub: { async fetch() { requests += 1; return Response.json({}); } },
  });
  assert.equal(idle.skipped, true);
  assert.equal(idle.reason, 'no-runtime-or-pages-task-due');
  assert.equal(requests, 0);
});

test('RuntimeCoordinator returns HTTP 500 and retains its lease after a graph failure', async () => {
  const durableStorage = storage();
  const originalError = console.error;
  console.error = () => {};
  try {
    const coordinator = new RuntimeCoordinator({ storage: durableStorage }, {}, {
      async runDirect() { throw new Error('scheduled graph failed'); },
    });
    const request = () => new Request('https://internal/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'run',
        cron: '* * * * *',
        scheduledTime: 230_000,
        leaseMs: 70_000,
      }),
    });
    const failed = await coordinator.fetch(request());
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: 'runtime-run-failed' });
    const duplicate = await coordinator.fetch(request());
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).reason, 'runtime-coordinator-duplicate');
  } finally {
    console.error = originalError;
  }
});

test('RuntimeCoordinator runs the graph once and exposes Durable Object waitUntil', async () => {
  const durableStorage = storage();
  const calls = [];
  const background = [];
  const state = {
    storage: durableStorage,
    waitUntil(task) { background.push(task); },
  };
  const coordinator = new RuntimeCoordinator(state, {}, {
    async runDirect(controller, env, ctx) {
      calls.push({ controller, lock: env.PRIMARY_RUN_LOCK_ENABLED });
      assert.equal(ctx, state);
      ctx.waitUntil(Promise.resolve('background'));
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
  assert.equal(background.length, 1);

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
  assert.equal(config.vars.RUNTIME_STATE_DO_ENABLED, true);
  assert.deepEqual(config.durable_objects.bindings, [{
    name: 'RUNTIME_COORDINATOR',
    class_name: 'RuntimeCoordinator',
  }]);
});
