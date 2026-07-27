import assert from 'node:assert/strict';
import test from 'node:test';

import { runRuntimeQueue } from '../src/runtime-queue.js';

function queueMessage(body, attempts = 1) {
  const calls = { ack: 0, retry: [] };
  return {
    body,
    attempts,
    ack() { calls.ack += 1; },
    retry(options) { calls.retry.push(options); },
    calls,
  };
}

test('unsupported runtime messages retry instead of being acknowledged and discarded', async () => {
  const first = queueMessage({ message_type: 'unexpected-one' }, 2);
  const second = queueMessage({ message_type: 'unexpected-two' }, 3);
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await runRuntimeQueue({
      queue: 'stationhead-unexpected',
      messages: [first, second],
    }, {}, {});

    assert.deepEqual(result, {
      unsupported: true,
      queue: 'stationhead-unexpected',
      retried: 2,
    });
    assert.equal(first.calls.ack, 0);
    assert.equal(second.calls.ack, 0);
    assert.deepEqual(first.calls.retry, [{ delaySeconds: 60 }]);
    assert.deepEqual(second.calls.retry, [{ delaySeconds: 60 }]);
  } finally {
    console.error = originalError;
  }
});

test('unsupported runtime messages fail closed when the queue runtime cannot retry', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      runRuntimeQueue({
        queue: 'stationhead-unexpected',
        messages: [{ body: { message_type: 'unexpected' }, attempts: 1 }],
      }, {}, {}),
      /cannot be retried/,
    );
  } finally {
    console.error = originalError;
  }
});
