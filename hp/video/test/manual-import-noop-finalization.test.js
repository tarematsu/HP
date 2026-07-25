import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { saveSourceFeedItems } from '../src/source-feed-storage.js';

function createStorageDb(results) {
  return {
    prepare() {
      return {
        bind() {
          return this;
        }
      };
    },
    async batch() {
      return results;
    }
  };
}

test('video persistence reports inserted and returned changes separately', async () => {
  const db = createStorageDb([
    {
      results: [{ inserted: 1 }, { inserted: 0 }],
      meta: { changes: 0 }
    }
  ]);
  const result = await saveSourceFeedItems(db, [
    { url: 'https://cdn.example/a.mp4', key: 'a', type: 'video' },
    { url: 'https://cdn.example/b.mp4', key: 'b', type: 'video' }
  ], '2026-07-18T22:00:00.000Z');

  assert.equal(result.inserted, 1);
  assert.equal(result.changed, 2);
  assert.equal(result.chunks, 1);
});

test('manual import finalizes only when a video row changed', async () => {
  const manualImportSource = await readFile(
    new URL('../src/manual-import.js', import.meta.url),
    'utf8'
  );
  const persistenceSource = await readFile(
    new URL('../src/source-feed-unlimited.js', import.meta.url),
    'utf8'
  );

  assert.match(manualImportSource, /Number\(result\.changed \|\| 0\) > 0/);
  assert.doesNotMatch(manualImportSource, /result\.imported > 0/);
  assert.match(persistenceSource, /changed: saved\.changed/);
  assert.match(persistenceSource, /changed: 0/);
});
