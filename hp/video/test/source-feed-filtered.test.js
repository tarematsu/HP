import assert from 'node:assert/strict';
import test from 'node:test';

import { createJsonKeyPayloads } from '../src/key-payloads.js';
import {
  filterExcludedItems,
  splitKnownCollectionItems
} from '../src/source-feed-filtered.js';

function statement(sql) {
  return {
    sql: sql.replace(/\s+/g, ' ').trim(),
    bind(...args) {
      this.args = args;
      return this;
    }
  };
}

function createDb({ orientationKeys = [] } = {}) {
  let stateReads = 0;
  const orientationStatements = [];
  const changed = new Set(orientationKeys);
  return {
    get stateReads() {
      return stateReads;
    },
    get orientationWrites() {
      return orientationStatements.length;
    },
    get orientationStatements() {
      return orientationStatements;
    },
    prepare(sql) {
      return statement(sql);
    },
    async batch(statements) {
      return statements.map((item) => {
        if (item.sql.includes('LEFT JOIN video_orientations AS saved')) {
          stateReads += 1;
          const payload = JSON.parse(item.args[0]);
          const results = [];
          for (const entry of payload) {
            if (entry.key === 'key-10') {
              results.push({ canonicalKey: entry.key, orientation: entry.orientation, listType: 'blocked' });
            } else if (entry.key === 'key-20') {
              results.push({ canonicalKey: entry.key, orientation: entry.orientation, listType: 'death' });
            } else if (changed.has(entry.key)) {
              results.push({ canonicalKey: entry.key, orientation: entry.orientation, listType: 'orientation' });
            }
          }
          return { results, meta: { changes: 0 } };
        }
        if (item.sql.includes('INSERT INTO video_orientations')) {
          orientationStatements.push(item);
        }
        return { results: [], meta: { changes: 0 } };
      });
    }
  };
}

test('key payloads stay bounded while retaining every key', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    key: `key-${index}-${'x'.repeat(40)}`
  }));
  const payloads = createJsonKeyPayloads(items, { maxBytes: 256, maxItems: 100 });
  assert.ok(payloads.length > 1);
  assert.deepEqual(
    payloads.flatMap((payload) => JSON.parse(payload)),
    items.map((item) => item.key)
  );
});

test('empty exclusion filtering performs no D1 work', async () => {
  let prepares = 0;
  let batches = 0;
  const db = {
    prepare(sql) {
      prepares += 1;
      return statement(sql);
    },
    async batch() {
      batches += 1;
      return [];
    }
  };

  const result = await filterExcludedItems(db, []);
  assert.deepEqual(result, { items: [], blockedCount: 0, deathCount: 0 });
  assert.equal(prepares, 0);
  assert.equal(batches, 0);
});

test('known collection items are removed from repeated exclusion and orientation work', () => {
  const items = [
    { key: 'first', url: 'https://cdn.example/first.mp4' },
    { key: 'shared', url: 'https://cdn.example/shared.mp4' },
    { key: 'last', url: 'https://cdn.example/last.mp4' }
  ];
  const result = splitKnownCollectionItems(items, new Set(['shared']));
  assert.deepEqual(result.knownItems, [items[1]]);
  assert.deepEqual(result.uncheckedItems, [items[0], items[2]]);
});

test('missing collection seen set leaves every item unchecked', () => {
  const items = [{ key: 'one' }, { key: 'two' }];
  assert.deepEqual(splitKnownCollectionItems(items, null), {
    knownItems: [],
    uncheckedItems: items
  });
});

test('only missing or changed orientation metadata is written', async () => {
  const db = createDb({ orientationKeys: ['key-30', 'key-31'] });
  const items = Array.from({ length: 1200 }, (_, index) => ({
    key: `key-${index}`,
    url: `https://cdn.example/${index % 2 ? '720x1280' : '1280x720'}/${index}.mp4`,
    orientation: index % 2 ? 'vertical' : 'horizontal'
  }));

  const result = await filterExcludedItems(db, items);
  assert.equal(db.stateReads, 2);
  assert.equal(db.orientationWrites, 1);
  assert.equal(result.blockedCount, 1);
  assert.equal(result.deathCount, 1);
  assert.equal(result.items.length, 1198);
  const written = db.orientationStatements.flatMap((item) => JSON.parse(item.args[0]));
  assert.deepEqual(written.map((item) => item.key), ['key-30', 'key-31']);
});

test('unchanged orientation metadata skips the upsert batch', async () => {
  const db = createDb();
  const items = [
    { key: 'key-1', orientation: 'horizontal' },
    { key: 'key-2', orientation: 'vertical' }
  ];

  const result = await filterExcludedItems(db, items);
  assert.equal(db.stateReads, 1);
  assert.equal(db.orientationWrites, 0);
  assert.deepEqual(result.items, items);
});
