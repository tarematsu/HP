import assert from 'node:assert/strict';
import test from 'node:test';

import { closeStaleCollectionRuns } from '../src/scheduled-collection.js';

function createDb(changes = 0) {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return {
        sql: sql.replace(/\s+/g, ' ').trim(),
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() {
          statements.push(this);
          return { meta: { changes } };
        }
      };
    }
  };
}

test('stale collection cleanup uses one D1 update for all selected sources', async () => {
  const db = createDb(2);
  const configs = [
    { method: 'source-a-browser' },
    { method: 'source-b-browser' },
    { method: 'source-e-browser' }
  ];

  const changed = await closeStaleCollectionRuns(
    { DB: db },
    configs,
    Date.parse('2026-07-05T00:00:00.000Z')
  );

  assert.equal(changed, 2);
  assert.equal(db.statements.length, 1);
  assert.equal(db.statements[0].sql.startsWith('UPDATE collection_runs'), true);
  assert.equal((db.statements[0].sql.match(/source_method = \?/g) || []).length, 3);
  assert.equal(db.statements[0].args.length, 7);
  assert.equal(db.statements[0].args[0], '2026-07-05T00:00:00.000Z');
});

test('stale collection cleanup skips D1 for an empty source group', async () => {
  const db = createDb();
  assert.equal(await closeStaleCollectionRuns({ DB: db }, []), 0);
  assert.equal(db.statements.length, 0);
});
