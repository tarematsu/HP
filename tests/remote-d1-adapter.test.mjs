import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  bindD1Sql,
  createWranglerRemoteD1,
  parseWranglerD1Json,
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

test('remote D1 failures preserve Wrangler stderr', async () => {
  const db = createWranglerRemoteD1({
    database: 'test-db',
    cwd: workerRoot,
    wranglerScript: '/tmp/wrangler.js',
    execFileSync() {
      const error = new Error('command failed');
      error.stderr = 'D1_ERROR: missing table sh_example';
      throw error;
    },
  });
  await assert.rejects(
    db.prepare('SELECT * FROM sh_example').all(),
    /Wrangler D1 execute failed for test-db: D1_ERROR: missing table sh_example/,
  );
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
