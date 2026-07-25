import assert from 'node:assert/strict';
import test from 'node:test';
import { saveMinuteFactWithinBudget, withAbortableMinuteFactD1 } from '../src/minute-facts-write-budget.js';

test('minute fact D1 remains guarded after bind', async () => {
  const controller = new AbortController();
  const db = { prepare() { return { bind() { return this; }, async run() { controller.abort(new Error('deadline')); return {}; } }; } };
  await assert.rejects(withAbortableMinuteFactD1(db, controller.signal).prepare('x').bind().run(), /deadline/);
});

test('minute fact batch checks abort after completion', async () => {
  const controller = new AbortController();
  const db = { async batch() { controller.abort(new Error('batch deadline')); return []; } };
  await assert.rejects(withAbortableMinuteFactD1(db, controller.signal).batch([]), /batch deadline/);
});

test('minute fact write rejects an already aborted signal', async () => {
  const controller = new AbortController();
  controller.abort(new Error('already cancelled'));
  await assert.rejects(saveMinuteFactWithinBudget({ __COLLECTION_ABORT_SIGNAL: controller.signal }, {}, async () => ({ ok: true })), /already cancelled/);
});

test('minute fact budget inherits immutable env values and owns guarded bindings', async () => {
  const db = { prepare() { return { bind() { return this; }, async run() { return {}; } }; } };
  const env = Object.freeze({ MINUTE_DB: db, COLLECTOR_ID: 'collector' });
  const result = await saveMinuteFactWithinBudget(env, {}, async (active) => ({
    collectorId: active.COLLECTOR_ID,
    inheritsEnv: Object.getPrototypeOf(active) === env,
    ownsMinuteDb: Object.hasOwn(active, 'MINUTE_DB'),
    wrapsMinuteDb: active.MINUTE_DB !== db,
  }));
  assert.deepEqual(result, {
    collectorId: 'collector',
    inheritsEnv: true,
    ownsMinuteDb: true,
    wrapsMinuteDb: true,
  });
});

test('disabled Queue write timeout waits for the in-flight D1 writer', async () => {
  const db = { marker: 'minute-db' };
  const env = { MINUTE_FACT_TIMEOUT_MS: 0, MINUTE_DB: db };
  let completed = false;

  const result = await saveMinuteFactWithinBudget(env, { id: 1 }, async (active, input) => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(active, env);
    assert.equal(active.MINUTE_DB, db);
    completed = true;
    return { input };
  });

  assert.equal(completed, true);
  assert.deepEqual(result, { input: { id: 1 } });
});

test('runtime timeout disable wins over a derive child timeout override', async () => {
  const runtime = { MINUTE_FACT_TIMEOUT_MS: 0, MINUTE_DB: { marker: 'db' } };
  const derive = Object.create(runtime);
  Object.defineProperty(derive, 'MINUTE_FACT_TIMEOUT_MS', {
    value: 18_000,
    enumerable: true,
    configurable: true,
  });

  const result = await saveMinuteFactWithinBudget(derive, {}, async (active) => ({
    sameEnv: active === derive,
    timeout: active.MINUTE_FACT_TIMEOUT_MS,
    inheritedDisable: Object.getPrototypeOf(active).MINUTE_FACT_TIMEOUT_MS,
  }));

  assert.deepEqual(result, {
    sameEnv: true,
    timeout: 18_000,
    inheritedDisable: 0,
  });
});

test('disabled timeout still rejects work cancelled before D1 starts', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled before start'));
  let called = false;

  await assert.rejects(
    saveMinuteFactWithinBudget({
      MINUTE_FACT_TIMEOUT_MS: 0,
      __COLLECTION_ABORT_SIGNAL: controller.signal,
    }, {}, async () => {
      called = true;
    }),
    /cancelled before start/,
  );
  assert.equal(called, false);
});
