import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginCollectionRun,
  recordCollectionFailure
} from '../src/source-feed.js';

function createFakeDb() {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql: sql.replace(/\s+/g, ' ').trim(), args: [] };
      calls.push(call);
      return {
        bind(...args) {
          call.args = args;
          return this;
        },
        async run() {
          if (call.sql.startsWith('INSERT INTO collection_runs')) {
            return { meta: { last_row_id: 42 } };
          }
          return { meta: {} };
        }
      };
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
}

test('failed collections keep the original run and save all three durations', async () => {
  const DB = createFakeDb();
  const env = { DB };
  const config = {
    sourceUrl: 'https://example.test/ranking',
    method: 'test-collector'
  };

  const run = await beginCollectionRun(env, config);
  await new Promise((resolve) => setTimeout(resolve, 2));
  const timings = await recordCollectionFailure(
    env,
    { ...config, run },
    new Error('collection failed')
  );

  const runInserts = DB.calls.filter((call) => call.sql.startsWith('INSERT INTO collection_runs'));
  assert.equal(runInserts.length, 1);
  assert.equal(run.runId, 42);

  const resultUpdate = DB.calls.find((call) => call.sql.startsWith('UPDATE collection_runs'));
  assert.ok(resultUpdate);
  assert.equal(resultUpdate.args[1], 0);
  assert.equal(resultUpdate.args[2], 0);
  assert.equal(resultUpdate.args[3], 'collection failed');
  assert.equal(resultUpdate.args[4], 42);

  const timingInsert = DB.calls.find((call) => call.sql.startsWith('INSERT INTO collection_run_timings'));
  assert.ok(timingInsert);
  assert.equal(timingInsert.args[0], 42);
  assert.ok(timingInsert.args[1] >= 0);
  assert.ok(timingInsert.args[2] >= 0);
  assert.ok(timingInsert.args[3] >= timingInsert.args[1]);

  assert.deepEqual(timings, {
    collectionDurationMs: timingInsert.args[1],
    databaseDurationMs: timingInsert.args[2],
    totalDurationMs: timingInsert.args[3]
  });
});
