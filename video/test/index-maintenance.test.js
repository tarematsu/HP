import assert from 'node:assert/strict';
import test from 'node:test';

import { ensureDbIndexes } from '../src/db-indexes.js';
import { ensureVideoDeathListTable } from '../src/video-death-list.js';

function createDb() {
  const statements = [];
  return {
    statements,
    prepare(sql) {
      return { sql: sql.replace(/\s+/g, ' ').trim() };
    },
    async batch(batch) {
      statements.push(...batch.map((item) => item.sql));
      return batch.map(() => ({ results: [], meta: { changes: 0 } }));
    }
  };
}

test('video index guard performs no runtime DDL after versioned migrations', async () => {
  const db = createDb();
  await ensureDbIndexes(db);
  await ensureDbIndexes(db);

  assert.deepEqual(db.statements, []);
});

test('Death schema performs no runtime DDL after versioned migrations', async () => {
  const db = createDb();
  await ensureVideoDeathListTable(db);
  await ensureVideoDeathListTable(db);

  assert.deepEqual(db.statements, []);
});
