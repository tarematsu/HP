import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CollectionTimeoutError,
  createOverallCollectionGuard,
  DEFAULT_SOURCE_TIMEOUT_MS,
  isCollectionTimeout,
  OVERALL_COLLECTION_TIMEOUT_MS,
  runWithCollectionTimeout,
  SOURCE_TIMEOUTS_MS,
  timeoutForMethod
} from '../src/collection-guardrails.js';

function waitForAbort(signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 1_000);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

test('active browser collectors expose explicit timeout limits', () => {
  assert.deepEqual(SOURCE_TIMEOUTS_MS, {
    'source-a-browser': 120_000,
    'source-b-browser': 120_000,
    'source-e-browser': 120_000
  });
  assert.equal(timeoutForMethod('source-a-browser'), 120_000);
  assert.equal(timeoutForMethod('source-b-browser'), 120_000);
  assert.equal(timeoutForMethod('source-e-browser'), 120_000);
  assert.equal(timeoutForMethod('unknown-source'), DEFAULT_SOURCE_TIMEOUT_MS);
  assert.equal(OVERALL_COLLECTION_TIMEOUT_MS, 300_000);
});

test('individual guardrail aborts the running task', async () => {
  let receivedSignal;
  await assert.rejects(
    runWithCollectionTimeout(async (signal) => {
      receivedSignal = signal;
      await waitForAbort(signal);
    }, {
      timeoutMs: 10,
      scope: 'test-source'
    }),
    (error) => isCollectionTimeout(error) && error.scope === 'test-source'
  );
  assert.equal(receivedSignal.aborted, true);
});

test('parent abort stops an individual task with the parent reason', async () => {
  const parent = new AbortController();
  const reason = new CollectionTimeoutError('overall collection', 20);
  const promise = runWithCollectionTimeout(
    async (signal) => waitForAbort(signal),
    {
      timeoutMs: 1000,
      scope: 'child-source',
      parentSignal: parent.signal
    }
  );
  parent.abort(reason);
  await assert.rejects(promise, (error) => error === reason);
});

test('overall guard aborts after its configured limit', async () => {
  const guard = createOverallCollectionGuard(10);
  try {
    await new Promise((resolve) => guard.signal.addEventListener('abort', resolve, { once: true }));
    assert.equal(guard.signal.aborted, true);
    assert.equal(isCollectionTimeout(guard.signal.reason), true);
    assert.equal(guard.signal.reason.scope, 'overall collection');
  } finally {
    guard.dispose();
  }
});
