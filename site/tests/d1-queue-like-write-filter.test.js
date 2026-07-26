import assert from 'node:assert/strict';
import test from 'node:test';

import { withoutQueueItemLikeMirrors } from '../functions/lib/d1-queue-like-write-filter.js';

function fakeDb() {
  const batches = [];
  return {
    batches,
    prepare(sql) {
      return {
        sql: String(sql),
        params: [],
        bind(...params) {
          this.params = params;
          return this;
        },
        async run() {
          return { success: true, meta: { changes: 1 }, sql: this.sql };
        },
      };
    },
    async batch(statements) {
      batches.push(statements);
      return statements.map((statement) => ({
        success: true,
        meta: { changes: 1 },
        sql: statement.sql,
      }));
    },
  };
}

test('queue item like mirrors are omitted while canonical statements retain result ordering', async () => {
  const db = fakeDb();
  const filtered = withoutQueueItemLikeMirrors(db);
  const canonical = filtered.prepare('INSERT INTO sh_track_like_current VALUES (?)').bind(1);
  const mirrored = filtered.prepare(`UPDATE sh_queue_items
    SET bite_count=?
    WHERE station_id IS ?`).bind(2, 3);
  const observation = filtered.prepare('INSERT INTO sh_track_like_observations VALUES (?)').bind(4);

  const results = await filtered.batch([canonical, mirrored, observation]);

  assert.equal(db.batches.length, 1);
  assert.deepEqual(db.batches[0].map(({ sql }) => sql), [
    'INSERT INTO sh_track_like_current VALUES (?)',
    'INSERT INTO sh_track_like_observations VALUES (?)',
  ]);
  assert.deepEqual(results.map(({ meta }) => meta.changes), [1, 0, 1]);
});

test('a mirrored statement run is a no-op outside batch execution', async () => {
  const db = fakeDb();
  const filtered = withoutQueueItemLikeMirrors(db);
  const statement = filtered.prepare('UPDATE sh_queue_items SET bite_count=? WHERE position=?')
    .bind(5, 6);

  assert.deepEqual(await statement.run(), { success: true, meta: { changes: 0 } });
  assert.deepEqual(db.batches, []);
});
