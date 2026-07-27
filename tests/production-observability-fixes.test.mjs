import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import deployedWorker from '../worker/src/runtime-orchestrator-deployed-entry.js';
import {
  TRACK_HISTORY_RESPONSE_MAX_CHUNKS,
} from '../worker/src/pages-track-history-response.js';

test('deployed runtime is queue-only with materialized-response serving and live-job coordination', () => {
  assert.deepEqual(Object.keys(deployedWorker).sort(), ['fetch', 'queue']);

  const config = JSON.parse(readFileSync(
    new URL('../worker/wrangler.runtime.jsonc', import.meta.url),
    'utf8',
  ));
  const entry = readFileSync(
    new URL('../worker/src/runtime-orchestrator-deployed-entry.js', import.meta.url),
    'utf8',
  );
  const actions = readFileSync(
    new URL('../worker/scripts/run-runtime-offline-maintenance-actions.mjs', import.meta.url),
    'utf8',
  );

  assert.equal(config.main, 'src/runtime-orchestrator-deployed-entry.js');
  assert.equal(config.triggers, undefined);
  assert.deepEqual(config.durable_objects, {
    bindings: [{ name: 'MINUTE_LIVE_JOB_COORDINATOR', class_name: 'MinuteLiveJobCoordinator' }],
  });
  assert.doesNotMatch(entry, /scheduled\s*:|runRuntimeOrchestratorScheduled/);
  assert.match(entry, /MinuteLiveJobCoordinator/);
  assert.match(actions, /runRollupMaintenance/);
  assert.match(actions, /pruneOldSnapshots/);
  assert.match(actions, /runStreamGoalPrediction/);
});

test('track-history response capacity covers the production publication', () => {
  assert.equal(TRACK_HISTORY_RESPONSE_MAX_CHUNKS, 256);
  assert.ok(TRACK_HISTORY_RESPONSE_MAX_CHUNKS > 80);
});
