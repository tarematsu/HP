import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { runPagesReadModelActions } from '../scripts/run-pages-read-model-actions.mjs';
import { advanceTrackHistoryPublication } from '../src/pages-track-history-publication.js';
import {
  assembledTrackHistoryPublicationForTest,
  createTrackHistoryPublication,
  splitTrackHistoryPublicationRows,
} from '../src/pages-track-history-response.js';
import { runSplitTrackHistoryCycleStep } from '../src/pages-track-history-split-cycle.js';

const CYCLE_START = Date.UTC(2026, 6, 18, 0, 0, 0);

function row(index) {
  return {
    row_key: `row-${String(index).padStart(4, '0')}`,
    play_date: '2026-07-18',
    first_played_at: index,
    row_json: JSON.stringify({ index, title: `Song ${index}` }),
  };
}

function baseStage(overrides = {}) {
  return {
    generation: CYCLE_START,
    published: false,
    refresh_mode: 'incremental',
    previous_full_at: CYCLE_START - 86_400_000,
    previous_status: { source_row_count: 7, excluded_play_count_dates: [] },
    ranges: {
      recent: { fromTs: CYCLE_START - 86_400_000, toTs: CYCLE_START + 86_400_000 },
      full_recent: { fromTs: CYCLE_START - 35 * 86_400_000, toTs: CYCLE_START + 86_400_000 },
      backfill: null,
    },
    tasks: [{ id: 'recent:0', kind: 'recent', range: { fromTs: CYCLE_START, toTs: CYCLE_START + 1 } }],
    completed: { 'recent:0': { sourceRowCount: 3, excludedDates: [] } },
    ...overrides,
  };
}

test('paged track-history chunks assemble the existing API response contract', () => {
  const publication = createTrackHistoryPublication(
    { generation: CYCLE_START },
    {
      generated_at: CYCLE_START,
      source_row_count: 2,
      excluded_play_count_dates: ['2026-07-01'],
    },
    CYCLE_START,
  );
  const chunks = splitTrackHistoryPublicationRows([row(1), row(2)], 0, 80);
  const payload = JSON.parse(assembledTrackHistoryPublicationForTest(publication, chunks));

  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'tracks');
  assert.equal(payload.from, '2024-05-01');
  assert.equal(payload.to, '2026-07-18');
  assert.deepEqual(payload.rows, [
    { index: 1, title: 'Song 1' },
    { index: 2, title: 'Song 2' },
  ]);
  assert.equal(payload.truncated, false);
  assert.equal(payload.likes_included, true);
  assert.equal(payload.source_row_count, 2);
  assert.deepEqual(payload.excluded_play_count_dates, ['2026-07-01']);
  assert.equal(payload.historical_recovery, 'worker_materialized_read_model');
  assert.equal(payload.method, 'precomputed_track_history_read_model');
});

test('publication advances by bounded rows and commits the manifest separately', async () => {
  const publication = {
    ...createTrackHistoryPublication(
      { generation: CYCLE_START },
      { generated_at: CYCLE_START },
      CYCLE_START,
      { PAGES_TRACK_HISTORY_ROWS_PER_STEP: 40 },
    ),
    limit: 1_000,
  };
  const written = [];
  const first = await advanceTrackHistoryPublication({}, publication, CYCLE_START + 60_000, {
    loadRows: async (_db, _state, limit) => {
      assert.equal(limit, 41);
      return Array.from({ length: 41 }, (_, index) => row(index));
    },
    writeChunks: async (_db, _state, chunks) => written.push(...chunks),
  });
  assert.equal(first.action, 'rows');
  assert.equal(first.rows, 40);
  assert.equal(first.publication.cursor.row_key, 'row-0039');
  assert.ok(written.length >= 1);

  const second = await advanceTrackHistoryPublication({}, first.publication, CYCLE_START + 120_000, {
    loadRows: async () => [row(40)],
    writeChunks: async () => {},
  });
  assert.equal(second.action, 'rows-complete');
  assert.equal(second.publication.phase, 'finalize');

  const committed = await advanceTrackHistoryPublication({}, second.publication, CYCLE_START + 180_000, {
    publishManifest: async (_db, state) => ({ chunks: state.next_chunk_index + 1 }),
  });
  assert.equal(committed.action, 'publish');
  assert.equal(committed.published, true);
});

test('split cycle initializes and advances one publication page inline', async () => {
  const stage = baseStage();
  const saves = [];
  const result = await runSplitTrackHistoryCycleStep(
    { BUDDIES_DB: {}, MINUTE_DB: {} },
    CYCLE_START + 12 * 60_000,
    {
      loadStage: async () => stage,
      finalizeStatus: async () => ({ generated_at: CYCLE_START, source_row_count: 3 }),
      initializePublication: async (_db, publication) => ({
        ...publication,
        phase: 'rows',
        next_chunk_index: 1,
        rows_written: 0,
      }),
      advancePublication: async (_db, publication) => ({
        action: 'rows',
        rows: 40,
        chunks: 1,
        published: false,
        publication: { ...publication, rows_written: 40, next_chunk_index: 2 },
      }),
      saveStage: async () => saves.push(stage.publication?.phase || 'none'),
    },
  );

  assert.equal(result.task.kind, 'track-history-publish-step');
  assert.equal(result.publication.action, 'rows');
  assert.equal(result.publication.rows_written, 40);
  assert.equal(stage.published, false);
  assert.deepEqual(saves, ['rows', 'rows']);
});

test('split cycle marks the stage published in the same inline state machine', async () => {
  const stage = baseStage({
    publication: {
      generation: 'generation-1',
      phase: 'finalize',
      rows_written: 40,
      next_chunk_index: 2,
    },
  });
  const result = await runSplitTrackHistoryCycleStep(
    { BUDDIES_DB: {}, MINUTE_DB: {} },
    CYCLE_START + 13 * 60_000,
    {
      loadStage: async () => stage,
      advancePublication: async (_db, publication) => ({
        action: 'publish',
        published: true,
        publication: { ...publication, phase: 'published' },
      }),
      saveStage: async () => {},
    },
  );

  assert.equal(result.task.kind, 'track-history-published');
  assert.equal(result.publication.published, true);
  assert.equal(stage.published, true);
  assert.equal(stage.publication.phase, 'published');
});

test('Actions runner keeps bounded stalled-publication recovery active without a Worker Queue', async () => {
  const runtime = JSON.parse(readFileSync(new URL('../wrangler.runtime.jsonc', import.meta.url), 'utf8'));
  let calls = 0;
  const result = await runPagesReadModelActions({
    startedAt: CYCLE_START + 19 * 60_000,
    deadlineMs: CYCLE_START + 30 * 60_000,
    now: () => CYCLE_START + 19 * 60_000,
    maxSteps: 3,
    env: { MINUTE_DB: {}, DB: {}, BUDDIES_DB: {}, OTHER_DB: {} },
    runTrackHistoryStep: async () => {
      calls += 1;
      return {
        task: { kind: calls === 3 ? 'track-history-published' : 'track-history-publish-step' },
        stage: { published: calls === 3 },
        publication: { published: calls === 3, phase: calls === 3 ? 'published' : 'rows' },
      };
    },
    materializeVariant: async (variant) => ({ key: variant.key }),
  });

  assert.equal(result.track_history_steps, 3);
  assert.equal(result.track_history_result.stage.published, true);
  assert.deepEqual(result.published.map(({ key }) => key), ['dashboard', 'track-history']);
  assert.equal(runtime.queues.consumers.some(({ queue }) => queue === 'stationhead-pages-read-model-publication'), false);
  assert.equal(runtime.queues.producers.some(({ binding }) => binding === 'PAGES_READ_MODEL_QUEUE'), false);
  assert.equal(runtime.triggers, undefined);
});
