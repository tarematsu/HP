import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { activeDeriveEnv, LIVE_DERIVE_QUEUE_NAME } from '../src/minute-derive-entry.js';
import { writeSparseLiveRevisionChunk } from '../src/minute-revision-materializer.js';

test('production keeps live revisions isolated while ordered derive uses the configured chunk', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.runtime.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.vars.DERIVE_REVISION_CHUNK_TRACKS, 20);
  const consumers = new Map(config.queues.consumers.map((consumer) => [consumer.queue, consumer]));
  assert.equal(consumers.get('stationhead-minute-derive').max_batch_size, 1);
  assert.equal(consumers.get('stationhead-minute-live-derive').max_batch_size, 1);
  assert.equal(consumers.get('stationhead-minute-live-derive').max_concurrency, 2);
  assert.equal(consumers.get('stationhead-buddies-facts').max_batch_size, 1);
  assert.equal(consumers.has('stationhead-minute-rebuild'), false);

  const live = activeDeriveEnv({ queue: LIVE_DERIVE_QUEUE_NAME }, {
    DERIVE_REVISION_CHUNK_TRACKS: config.vars.DERIVE_REVISION_CHUNK_TRACKS,
    MINUTE_LIVE_DERIVE_QUEUE: { send() {} },
    MINUTE_DERIVE_QUEUE: { send() {} },
  });
  assert.equal(live.DERIVE_REVISION_CHUNK_TRACKS, 1);
});

test('sparse materializer respects the bounded two-track chunk', async () => {
  let requestedLimit = null;
  const result = await writeSparseLiveRevisionChunk({
    MINUTE_DB: {},
    DERIVE_REVISION_CHUNK_TRACKS: 2,
  }, {
    revision_id: 10,
    source_job_id: 20,
    visible_item_count: 8,
    total_item_count: 8,
    materialized_item_count: 0,
    preferred_position: 3,
    enrichment: { observed_at: 100_000 },
  }, {
    loadSourceTracks: async (_db, _state, limit) => {
      requestedLimit = limit;
      return [];
    },
    resolveTracksBulk: async () => [],
    materializedCount: async () => 8,
    updateCoverage: async () => {},
  });
  assert.equal(requestedLimit, 2);
  assert.equal(result.complete, true);
});
