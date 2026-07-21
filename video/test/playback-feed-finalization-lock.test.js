import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { withPlaybackFeedFinalization } from '../src/d1-compaction.js';

const source = await readFile(new URL('../src/d1-compaction.js', import.meta.url), 'utf8');

function createLockDb() {
  const state = {
    contentHash: 'initial-hash',
    rowCount: 3,
    version: 0,
    updatedAt: '2026-07-11T00:00:00.000Z'
  };
  const statements = [];

  return {
    state,
    statements,
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      return {
        args: [],
        bind(...args) {
          this.args = args;
          return this;
        },
        async first() {
          statements.push(normalized);
          if (!normalized.startsWith('UPDATE playback_feed_state')) return null;
          if (!normalized.includes('RETURNING content_hash AS contentHash')) return null;
          const [token, lockedAt, , staleBefore] = this.args;
          const lockActive = String(state.contentHash || '').startsWith('finalizing:')
            && state.updatedAt
            && state.updatedAt > staleBefore;
          if (lockActive) return null;
          state.contentHash = token;
          state.updatedAt = lockedAt;
          state.version += 1;
          return { contentHash: token };
        },
        async run() {
          statements.push(normalized);
          if (normalized.includes('SET content_hash=?, row_count=?')) {
            const [contentHash, rowCount, updatedAt, token] = this.args;
            if (state.contentHash !== token) return { meta: { changes: 0 } };
            state.contentHash = contentHash;
            state.rowCount = rowCount;
            state.updatedAt = updatedAt;
            state.version += 1;
            return { meta: { changes: 1 } };
          }

          if (normalized.includes('SET content_hash=NULL')) {
            const [updatedAt, token] = this.args;
            if (state.contentHash !== token) return { meta: { changes: 0 } };
            state.contentHash = null;
            state.updatedAt = updatedAt;
            state.version += 1;
            return { meta: { changes: 1 } };
          }

          return { meta: { changes: 0 } };
        }
      };
    }
  };
}

function outcome(contentHash, rowCount) {
  return {
    value: rowCount,
    contentHash,
    rowCount,
    updatedAt: `2026-07-11T00:00:0${rowCount}.000Z`
  };
}

test('concurrent playback feed finalizers fail fast without polling', async () => {
  const db = createLockDb();
  let releaseFirst;
  let firstStartedResolve;
  const firstStarted = new Promise((resolve) => {
    firstStartedResolve = resolve;
  });
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = withPlaybackFeedFinalization(db, async () => {
    firstStartedResolve();
    await firstGate;
    return outcome('first-hash', 1);
  }, { ttlMs: 5_000 });

  await firstStarted;
  let secondTaskStarted = false;
  await assert.rejects(
    withPlaybackFeedFinalization(db, async () => {
      secondTaskStarted = true;
      return outcome('second-hash', 2);
    }, { ttlMs: 5_000 }),
    /Playback feed finalization is busy/
  );
  assert.equal(secondTaskStarted, false);

  releaseFirst();
  assert.equal(await first, 1);
  assert.equal(db.state.contentHash, 'first-hash');
  assert.equal(db.statements.filter((sql) => sql.includes('RETURNING content_hash')).length, 2);
  assert.ok(db.statements.every((sql) => !sql.startsWith('SELECT content_hash')));
});

test('failed finalization abandons its lock so the next run can recover', async () => {
  const db = createLockDb();

  await assert.rejects(
    withPlaybackFeedFinalization(db, async () => {
      throw new Error('database write failed');
    }, { ttlMs: 5_000 }),
    /database write failed/
  );
  assert.equal(db.state.contentHash, null);

  const result = await withPlaybackFeedFinalization(
    db,
    async () => outcome('recovered-hash', 4),
    { ttlMs: 5_000 }
  );
  assert.equal(result, 4);
  assert.equal(db.state.contentHash, 'recovered-hash');
});

test('feed finalization lock contains no retry loop or sleep', () => {
  assert.match(source, /RETURNING content_hash AS contentHash/);
  assert.doesNotMatch(source, /while \(true\)/);
  assert.doesNotMatch(source, /setTimeout/);
  assert.doesNotMatch(source, /maxWaitMs|retryMs/);
});
