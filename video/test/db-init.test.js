import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureDatabaseOnce } from '../src/db-init.js';

test('database initializer is shared for the same binding and key', async () => {
  const db = {};
  let calls = 0;
  const initialize = async () => {
    calls += 1;
    await Promise.resolve();
    return 'ready';
  };

  const [first, second] = await Promise.all([
    ensureDatabaseOnce(db, 'schema', initialize),
    ensureDatabaseOnce(db, 'schema', initialize)
  ]);

  assert.equal(first, 'ready');
  assert.equal(second, 'ready');
  assert.equal(calls, 1);
});

test('failed database initializer can be retried', async () => {
  const db = {};
  let calls = 0;
  const initialize = async () => {
    calls += 1;
    if (calls === 1) throw new Error('temporary failure');
    return 'ready';
  };

  await assert.rejects(ensureDatabaseOnce(db, 'schema', initialize), /temporary failure/);
  assert.equal(await ensureDatabaseOnce(db, 'schema', initialize), 'ready');
  assert.equal(calls, 2);
});
