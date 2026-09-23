import assert from 'node:assert/strict';
import test from 'node:test';

import {
  refreshWeeklyRankingReadModelIfStale,
} from '../worker/scripts/materialize-weekly-ranking-read-model-if-stale.mjs';

const SOURCE = Object.freeze({
  max_ranking_date: '2026-09-21',
  max_ranking_imported_at: 200,
  max_weekly_summary_updated_at: 180,
  max_fandom_verified_at: 150,
});

test('fresh weekly ranking source does not invoke the heavy materializer', async () => {
  let materializeCalls = 0;
  let invalidateCalls = 0;
  const result = await refreshWeeklyRankingReadModelIfStale({}, 500, {
    loadSourceRevision: async () => SOURCE,
    loadReadModelState: async () => ({
      source_max_ranking_date: '2026-09-21',
      refreshed_at: 200,
      chunk_complete: true,
    }),
    invalidate: async () => { invalidateCalls += 1; },
    materialize: async () => {
      materializeCalls += 1;
      throw new Error('fresh source must not materialize');
    },
  });

  assert.equal(result.status, 'unchanged');
  assert.equal(result.reason, 'source-revision-current');
  assert.equal(materializeCalls, 0);
  assert.equal(invalidateCalls, 0);
});

test('same-week source revision invalidates the old marker before rebuilding', async () => {
  const calls = [];
  const result = await refreshWeeklyRankingReadModelIfStale({}, 500, {
    loadSourceRevision: async () => ({ ...SOURCE, max_ranking_imported_at: 250 }),
    loadReadModelState: async () => ({
      source_max_ranking_date: '2026-09-21',
      refreshed_at: 200,
      chunk_complete: true,
    }),
    invalidate: async (_db, source, stored) => {
      calls.push(['invalidate', source.max_ranking_date, stored.source_max_ranking_date]);
      return true;
    },
    materialize: async (_db, now) => {
      calls.push(['materialize', now]);
      return {
        status: 'materialized',
        source_max_ranking_date: '2026-09-21',
        refreshed_at: now,
      };
    },
  });

  assert.deepEqual(calls, [
    ['invalidate', '2026-09-21', '2026-09-21'],
    ['materialize', 500],
  ]);
  assert.equal(result.status, 'materialized');
  assert.equal(result.source_revision, '2026-09-21:250:180:150');
});

test('missing ranking source skips materialization entirely', async () => {
  let storedCalls = 0;
  const result = await refreshWeeklyRankingReadModelIfStale({}, 500, {
    loadSourceRevision: async () => ({
      max_ranking_date: '',
      max_ranking_imported_at: 0,
      max_weekly_summary_updated_at: 0,
      max_fandom_verified_at: 0,
    }),
    loadReadModelState: async () => { storedCalls += 1; },
    materialize: async () => { throw new Error('missing source must not materialize'); },
  });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'no-ranking-source');
  assert.equal(storedCalls, 0);
});
