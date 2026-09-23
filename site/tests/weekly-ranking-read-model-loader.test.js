import assert from 'node:assert/strict';
import test from 'node:test';

import { loadWeeklyRankingReadModel } from '../functions/lib/weekly-ranking-read-model.js';

function chunkDb(chunks) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM sh_weekly_ranking_read_model_chunks/);
      return {
        bind(generationId) {
          assert.equal(generationId, 'gen-1');
          return {
            async all() {
              return {
                results: chunks.map((payload_chunk) => ({ payload_chunk })),
              };
            },
          };
        },
      };
    },
  };
}

test('chunked weekly ranking read model is reassembled in order', async () => {
  const model = {
    refreshed_at: 123,
    ranking_weeks: ['2026-09-21'],
    actual_rows: [{ ranking_date: '2026-09-21', host_name: 'sakuramankai', rank: 1 }],
    completed_rows: [],
    weekly_metrics: [],
  };
  const payload = JSON.stringify(model);
  const split = Math.floor(payload.length / 2);
  const stored = {
    payload_json: JSON.stringify({
      storage: 'chunked-json-v1',
      generation_id: 'gen-1',
      chunk_count: 2,
    }),
  };
  assert.deepEqual(
    await loadWeeklyRankingReadModel(chunkDb([payload.slice(0, split), payload.slice(split)]), stored),
    model,
  );
});

test('legacy one-row weekly ranking read model remains readable', async () => {
  const model = { actual_rows: [], completed_rows: [], ranking_weeks: [], weekly_metrics: [] };
  const db = { prepare() { throw new Error('chunks must not be queried for legacy payloads'); } };
  assert.deepEqual(
    await loadWeeklyRankingReadModel(db, { payload_json: JSON.stringify(model) }),
    model,
  );
});

test('incomplete chunk generation is rejected instead of serving partial JSON', async () => {
  const stored = {
    payload_json: JSON.stringify({
      storage: 'chunked-json-v1',
      generation_id: 'gen-1',
      chunk_count: 2,
    }),
  };
  assert.equal(await loadWeeklyRankingReadModel(chunkDb(['{}']), stored), null);
});
