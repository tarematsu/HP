import assert from 'node:assert/strict';
import test from 'node:test';

import { filterDeathItems } from '../src/video-death-list.js';

function statement(sql, deadKeys = new Set()) {
  return {
    sql: sql.replace(/\s+/g, ' ').trim(),
    args: [],
    bind(...args) {
      this.args = args;
      return this;
    },
    async all() {
      const keys = JSON.parse(this.args[0]);
      return {
        results: keys
          .filter((key) => deadKeys.has(key))
          .map((canonicalKey) => ({ canonicalKey }))
      };
    }
  };
}

function createDb(deadKeys) {
  return {
    statements: [],
    prepare(sql) {
      const prepared = statement(sql, deadKeys);
      this.statements.push(prepared);
      return prepared;
    },
    async batch(statements) {
      return statements.map(() => ({ results: [], meta: { changes: 0 } }));
    }
  };
}

test('empty death-list filtering avoids database setup work', async () => {
  const db = {
    prepare() {
      throw new Error('prepare should not be called for an empty item list');
    },
    batch() {
      throw new Error('batch should not be called for an empty item list');
    }
  };

  const result = await filterDeathItems(db, []);

  assert.deepEqual(result, { items: [], deathCount: 0 });
});

test('missing death-list input is treated as empty without database work', async () => {
  const db = {
    prepare() {
      throw new Error('prepare should not be called for missing items');
    },
    batch() {
      throw new Error('batch should not be called for missing items');
    }
  };

  const result = await filterDeathItems(db);

  assert.deepEqual(result, { items: [], deathCount: 0 });
});

test('death-list filtering counts every skipped duplicate item', async () => {
  const db = createDb(new Set(['dead-a']));
  const items = [
    { key: 'dead-a', url: 'https://cdn.example/a.mp4' },
    { key: 'live-b', url: 'https://cdn.example/b.mp4' },
    { key: 'dead-a', url: 'https://cdn.example/a-duplicate.mp4' }
  ];

  const result = await filterDeathItems(db, items);

  assert.deepEqual(result.items, [items[1]]);
  assert.equal(result.deathCount, 2);
});

test('death-list filtering deduplicates database lookup keys', async () => {
  const db = createDb(new Set(['dead-a']));
  const items = [
    { key: 'dead-a', url: 'https://cdn.example/a.mp4' },
    { key: 'live-b', url: 'https://cdn.example/b.mp4' },
    { key: 'dead-a', url: 'https://cdn.example/a-duplicate.mp4' },
    { key: '', url: 'https://cdn.example/missing-key.mp4' }
  ];

  const result = await filterDeathItems(db, items);

  assert.deepEqual(result.items, [items[1], items[3]]);
  assert.equal(result.deathCount, 2);
  const queryStatement = db.statements.find((prepared) => prepared.sql.includes('json_each'));
  assert.deepEqual(JSON.parse(queryStatement.args[0]), ['dead-a', 'live-b']);
});
