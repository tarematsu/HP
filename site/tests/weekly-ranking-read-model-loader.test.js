import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadWeeklyRankingReadModel,
  resetWeeklyRankingReadModelCache,
} from '../functions/lib/weekly-ranking-read-model.js';

function chunkDb(chunks, { generationId = 'gen-1', onRead = () => {} } = {}) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM sh_weekly_ranking_read_model_chunks/);
      return {
        bind(actualGenerationId) {
          assert.equal(actualGenerationId, generationId);
          return {
            async all() {
              onRead();
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

function chunkedStored(generationId = 'gen-1', chunkCount = 2) {
  return {
    payload_json: JSON.stringify({
      storage: 'chunked-json-v1',
      generation_id: generationId,
      chunk_count: chunkCount,
    }),
  };
}

test('chunked weekly ranking read model is reassembled in order', async () => {
  resetWeeklyRankingReadModelCache();
  const model = {
    refreshed_at: 123,
    ranking_weeks: ['2026-09-21'],
    actual_rows: [{ ranking_date: '2026-09-21', host_name: 'sakuramankai', rank: 1 }],
    completed_rows: [],
    weekly_metrics: [],
  };
  const payload = JSON.stringify(model);
  const split = Math.floor(payload.length / 2);
  assert.deepEqual(
    await loadWeeklyRankingReadModel(
      chunkDb([payload.slice(0, split), payload.slice(split)]),
      chunkedStored(),
    ),
    model,
  );
});

test('same weekly ranking generation reuses the isolate cache without rereading chunks', async () => {
  resetWeeklyRankingReadModelCache();
  const model = { actual_rows: [{ host_name: 'sakuramankai' }], completed_rows: [] };
  const payload = JSON.stringify(model);
  const split = Math.floor(payload.length / 2);
  let reads = 0;
  const db = chunkDb([payload.slice(0, split), payload.slice(split)], {
    onRead() { reads += 1; },
  });
  const stored = chunkedStored();

  const first = await loadWeeklyRankingReadModel(db, stored);
  const second = await loadWeeklyRankingReadModel(db, stored);
  assert.equal(reads, 1);
  assert.strictEqual(second, first);
});

test('a new weekly ranking generation invalidates the isolate cache', async () => {
  resetWeeklyRankingReadModelCache();
  const firstModel = { generation: 1, actual_rows: [], completed_rows: [] };
  const firstPayload = JSON.stringify(firstModel);
  const firstSplit = Math.floor(firstPayload.length / 2);
  await loadWeeklyRankingReadModel(
    chunkDb([firstPayload.slice(0, firstSplit), firstPayload.slice(firstSplit)]),
    chunkedStored('gen-1'),
  );

  const secondModel = { generation: 2, actual_rows: [], completed_rows: [] };
  const secondPayload = JSON.stringify(secondModel);
  const secondSplit = Math.floor(secondPayload.length / 2);
  let reads = 0;
  const loaded = await loadWeeklyRankingReadModel(
    chunkDb([secondPayload.slice(0, secondSplit), secondPayload.slice(secondSplit)], {
      generationId: 'gen-2',
      onRead() { reads += 1; },
    }),
    chunkedStored('gen-2'),
  );

  assert.equal(reads, 1);
  assert.deepEqual(loaded, secondModel);
});

test('legacy one-row weekly ranking read model remains readable', async () => {
  resetWeeklyRankingReadModelCache();
  const model = { actual_rows: [], completed_rows: [], ranking_weeks: [], weekly_metrics: [] };
  const db = { prepare() { throw new Error('chunks must not be queried for legacy payloads'); } };
  assert.deepEqual(
    await loadWeeklyRankingReadModel(db, { payload_json: JSON.stringify(model) }),
    model,
  );
});

test('incomplete chunk generation is rejected and is not cached', async () => {
  resetWeeklyRankingReadModelCache();
  const stored = chunkedStored();
  assert.equal(await loadWeeklyRankingReadModel(chunkDb(['{}']), stored), null);

  const model = { actual_rows: [], completed_rows: [], ranking_weeks: [], weekly_metrics: [] };
  const payload = JSON.stringify(model);
  const split = Math.floor(payload.length / 2);
  let reads = 0;
  assert.deepEqual(
    await loadWeeklyRankingReadModel(
      chunkDb([payload.slice(0, split), payload.slice(split)], {
        onRead() { reads += 1; },
      }),
      stored,
    ),
    model,
  );
  assert.equal(reads, 1);
});
