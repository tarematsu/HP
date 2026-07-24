import assert from 'node:assert/strict';
import test from 'node:test';

import { feedContentHash, writeFeedState } from '../src/d1-compaction.js';

function createDb(changes) {
  const prepared = [];
  return {
    prepared,
    prepare(sql) {
      const statement = {
        sql: sql.replace(/\s+/g, ' ').trim(),
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async run() {
          return { meta: { changes } };
        }
      };
      prepared.push(statement);
      return statement;
    },
    async batch(statements) {
      return statements.map(() => ({ results: [], meta: { changes: 0 } }));
    }
  };
}

test('feed state write is conditional on hash or row-count changes', async () => {
  const db = createDb(0);
  const changed = await writeFeedState(db, 'same-hash', 42, '2026-07-05T00:00:00.000Z');
  const update = db.prepared.at(-1);

  assert.equal(changed, false);
  assert.match(update.sql, /content_hash IS NOT \? OR row_count <> \?/);
  assert.deepEqual(update.args, [
    'same-hash',
    42,
    '2026-07-05T00:00:00.000Z',
    'same-hash',
    42
  ]);
});

test('feed state write reports an actual metadata change', async () => {
  const db = createDb(1);
  assert.equal(
    await writeFeedState(db, 'new-hash', 43, '2026-07-05T00:01:00.000Z'),
    true
  );
});

test('feed hash keeps ids beyond Number safe integer range distinct', async () => {
  const first = await feedContentHash([{ videoId: '9007199254740992' }]);
  const second = await feedContentHash([{ videoId: '9007199254740993' }]);

  assert.notEqual(first, second);
});

test('feed hash does not collide through comma-delimited serialization', async () => {
  const first = await feedContentHash([{ videoId: '1,2' }, { videoId: '3' }]);
  const second = await feedContentHash([{ videoId: '1' }, { videoId: '2,3' }]);

  assert.notEqual(first, second);
});
