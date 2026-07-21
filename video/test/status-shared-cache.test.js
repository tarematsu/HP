import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import core from '../src/entry-core.js';
import entry from '../src/entry.js';
import { blockPlaybackMedia } from '../src/video-blocklist.js';

const entryCoreSource = readFileSync(new URL('../src/entry-core.js', import.meta.url), 'utf8');

test('status responses remain private without an entry response rewrite', () => {
  assert.equal(entry, core);
  assert.match(entryCoreSource, /'cache-control', 'private, no-store'/);
  assert.match(entryCoreSource, /headers: STATUS_RESPONSE_HEADERS/);
  assert.doesNotMatch(entryCoreSource, /x-edge-cache/i);
});

test('mutation requests do not touch the shared cache binding', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    get() {
      throw new Error('mutation requests must not access caches.default');
    }
  });

  try {
    const response = await entry.fetch(
      new Request('https://example.com/api/unknown', { method: 'POST' }),
      {},
      {}
    );
    assert.equal(response.status, 404);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'caches', previous);
    else delete globalThis.caches;
  }
});

test('entry contains no unused shared cache invalidation path', () => {
  const source = readFileSync(new URL('../src/entry.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /caches\.default/);
  assert.doesNotMatch(source, /cache\.delete/);
  assert.doesNotMatch(source, /cacheInvalidatingContext/);
  assert.doesNotMatch(source, /invalidateSharedStatusCache/);
});

test('playback exclusion persistence relies on an insert trigger instead of a full recount', () => {
  const source = readFileSync(
    new URL('../src/video-blocklist.js', import.meta.url),
    'utf8'
  );
  const migration = readFileSync(
    new URL('../migrations/100003_block_status_count_delta.sql', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(source, /refreshStatusCounts/);
  assert.doesNotMatch(source, /refreshStatusVideoCounts/);
  assert.doesNotMatch(source, /refreshStatusExclusionCounts/);
  assert.match(migration, /CREATE TRIGGER IF NOT EXISTS status_counts_delta_on_block_insert/);
  assert.match(migration, /blocked_videos = blocked_videos \+ 1/);
});

test('a committed playback exclusion completes with one transactional batch', async () => {
  let batchCall = 0;
  const makeStatement = (sql, binds = []) => ({
    sql,
    binds,
    bind(...nextBinds) {
      return makeStatement(sql, nextBinds);
    },
    async first() {
      return {
        alreadyBlocked: 0,
        id: 42,
        mediaUrl: 'https://media.example.test/example.mp4',
        canonicalKey: 'example'
      };
    }
  });
  const db = {
    prepare(sql) {
      return makeStatement(sql);
    },
    async batch(statements) {
      batchCall += 1;
      return statements.map((_statement, index) => ({
        meta: { changes: index === 0 ? 1 : 0 }
      }));
    }
  };
  const request = new Request('https://example.com/api/videos/block', {
    method: 'POST',
    headers: {
      authorization: 'Bearer admin-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ mediaUrl: 'https://media.example.test/example.mp4' })
  });

  const result = await blockPlaybackMedia({
    DB: db,
    ADMIN_TOKEN: 'admin-secret',
    MEDIA_HOST: 'media.example.test'
  }, request);

  assert.equal(result.status, 200);
  assert.equal(result.data.blocked, true);
  assert.equal(result.data.statusCountsRefreshed, true);
  assert.equal(batchCall, 1);
});
