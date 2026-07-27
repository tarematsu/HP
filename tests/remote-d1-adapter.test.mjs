import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  bindD1Sql,
  createWranglerRemoteD1,
  parseWranglerD1Json,
  transientWranglerD1Failure,
  wranglerD1Results,
} from '../worker/scripts/remote-d1-adapter.mjs';

const workerRoot = fileURLToPath(new URL('../worker/', import.meta.url));

const resultJson = (entries) => JSON.stringify(entries);

test('numbered D1 placeholders preserve indexes and repeated bindings', () => {
  assert.equal(
    bindD1Sql('SELECT ?1 AS first,?2 AS second,?1 AS repeated', [10, 20]),
    'SELECT 10 AS first,20 AS second,10 AS repeated',
  );
  assert.equal(
    bindD1Sql('SELECT ? AS first,? AS second', ['a', 'b']),
    "SELECT 'a' AS first,'b' AS second",
  );
});

test('D1 binding ignores question marks inside strings, identifiers, and comments', () => {
  const sql = "SELECT '?' AS literal,\"?\" AS identifier,?1 AS value -- ?\n/* ? */";
  assert.equal(
    bindD1Sql(sql, ['bound']),
    "SELECT '?' AS literal,\"?\" AS identifier,'bound' AS value -- ?\n/* ? */",
  );
});

test('Wrangler JSON parsing skips banners and preserves result metadata', () => {
  const output = `warning [retry]\n${resultJson([{
    success: true,
    results: [{ value: 1 }],
    meta: { changes: 7, rows_read: 3 },
  }])}`;
  assert.deepEqual(parseWranglerD1Json(output), [{
    success: true,
    results: [{ value: 1 }],
    meta: { changes: 7, rows_read: 3 },
  }]);
  assert.deepEqual(wranglerD1Results(output), [{
    success: true,
    results: [{ value: 1 }],
    meta: { changes: 7, rows_read: 3 },
  }]);
});

test('remote D1 run returns Wrangler meta.changes', async () => {
  const calls = [];
  const db = createWranglerRemoteD1({
    database: 'test-db',
    cwd: workerRoot,
    wranglerScript: '/tmp/wrangler.js',
    execFileSync(_command, args) {
      calls.push(args);
      return resultJson([{ success: true, results: [], meta: { changes: 9 } }]);
    },
  });
  const result = await db.prepare('UPDATE items SET value=?1 WHERE id=?2').bind('next', 5).run();
  assert.equal(result.meta.changes, 9);
  assert.match(calls[0].at(-1), /value='next' WHERE id=5/);
});

test('remote D1 retries Cloudflare code 7500 and preserves exponential delays', async () => {
  let attempts = 0;
  const delays = [];
  const transient = new Error('command failed');
  transient.stdout = JSON.stringify({ error: { code: 7500, notes: [{ text: 'internal error; reference = e_test' }] } });
  assert.equal(transientWranglerD1Failure(transient), true);

  const db = createWranglerRemoteD1({
    database: 'test-db',
    cwd: workerRoot,
    wranglerScript: '/tmp/wrangler.js',
    maxRetries: 2,
    retryDelayMs: 100,
    sleepSync(milliseconds) { delays.push(milliseconds); },
    execFileSync() {
      attempts += 1;
      if (attempts < 3) throw transient;
      return resultJson([{ success: true, results: [{ value: 1 }], meta: {} }]);
    },
  });

  assert.deepEqual(await db.prepare('SELECT 1 AS value').all(), {
    success: true,
    results: [{ value: 1 }],
    meta: {},
  });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);
});

test('remote D1 permanent failures are not retried and preserve Wrangler stderr', async () => {
  let attempts = 0;
  const db = createWranglerRemoteD1({
    database: 'test-db',
    cwd: workerRoot,
    wranglerScript: '/tmp/wrangler.js',
    execFileSync() {
      attempts += 1;
      const error = new Error('command failed');
      error.stderr = 'D1_ERROR: missing table sh_example';
      throw error;
    },
  });
  await assert.rejects(
    db.prepare('SELECT * FROM sh_example').all(),
    /Wrangler D1 execute failed for test-db: D1_ERROR: missing table sh_example/,
  );
  assert.equal(attempts, 1);
});

test('remote D1 batch uses command JSON output and returns per-statement metadata', async () => {
  const calls = [];
  const db = createWranglerRemoteD1({
    database: 'test-db',
    cwd: workerRoot,
    wranglerScript: '/tmp/wrangler.js',
    execFileSync(_command, args) {
      calls.push(args);
      return resultJson([
        { success: true, results: [], meta: { changes: 5000 } },
        { success: true, results: [], meta: { changes: 12 } },
      ]);
    },
  });
  const results = await db.batch([
    db.prepare('DELETE FROM first_table WHERE observed_at<?1').bind(100),
    db.prepare('DELETE FROM second_table WHERE observed_at<?1').bind(100),
  ]);
  assert.deepEqual(results.map(({ meta }) => meta.changes), [5000, 12]);
  assert.equal(calls[0].includes('--json'), true);
  assert.equal(calls[0].includes('--command'), true);
  assert.equal(calls[0].includes('--file'), false);
  const command = calls[0][calls[0].indexOf('--command') + 1];
  assert.match(command, /DELETE FROM first_table WHERE observed_at<100;/);
  assert.match(command, /DELETE FROM second_table WHERE observed_at<100;/);
});
