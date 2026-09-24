import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  HISTORY_READ_MODEL_VARIANTS,
  runPagesHistoryReadModelActions,
} from '../worker/scripts/run-pages-history-read-model-actions.mjs';

const workflow = readFileSync(
  new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url),
  'utf8',
);
const repairWorkflow = readFileSync(
  new URL('../.github/workflows/repair-pages-summaries.yml', import.meta.url),
  'utf8',
);

const NOW = Date.UTC(2026, 6, 28, 0, 4);
const HISTORY_KEYS = [
  'history:daily',
  'history:weekly',
  'history:broadcasts',
  'host-history:summary',
];

test('D1 budget deferral only reuses history and never refreshes dashboard', () => {
  assert.match(workflow, /name: Record D1 budget deferral/);
  assert.match(workflow, /name: Install Worker dependencies\n        run: npm ci/);
  assert.match(workflow, /name: Refresh reusable history models during D1 budget deferral/);
  assert.match(
    workflow,
    /if: steps\.d1-write-budget\.outputs\.read_allowed != 'true'[\s\S]*PAGES_READ_MODEL_REUSE_ONLY: 'true'[\s\S]*node scripts\/run-pages-history-read-model-actions\.mjs/,
  );
  assert.match(
    workflow,
    /name: Publish due pages read models\n        if: steps\.d1-write-budget\.outputs\.read_allowed == 'true'[\s\S]*node scripts\/run-pages-history-read-model-actions\.mjs/,
  );
  assert.doesNotMatch(workflow, /node scripts\/refresh-pages-dashboard-actions\.mjs/);
  assert.doesNotMatch(workflow, /node scripts\/refresh-pages-realtime-actions\.mjs/);
  assert.doesNotMatch(workflow, /node scripts\/repair-pages-summary-gaps\.mjs/);
  assert.match(repairWorkflow, /cron: '23 4 \* \* \*'/);
  assert.match(repairWorkflow, /node scripts\/repair-pages-summary-gaps\.mjs/);
  assert.match(repairWorkflow, /PAGES_STREAM_ZERO_REPAIR_ENABLED: 'true'/);
  assert.match(workflow, /reuse-only history freshness checks will still run\./);
  assert.match(workflow, /site\/functions\/lib\/materialized-history\.js/);
  assert.doesNotMatch(workflow, /Rebuild track history|track-history generation/);
});

test('budget fallback keeps every active history model reuse-only and excludes dashboard', async () => {
  assert.deepEqual(HISTORY_READ_MODEL_VARIANTS.map(({ key }) => key), HISTORY_KEYS);
  const published = [];
  const reuseOnly = [];
  const result = await runPagesHistoryReadModelActions({
    reuseOnly: true,
    startedAt: NOW,
    deadlineMs: NOW + 60_000,
    now: () => NOW,
    env: { MINUTE_DB: {}, DB: {}, BUDDIES_DB: {}, OTHER_DB: {} },
    materializeVariant: async (variant, _env, _now, dependencies) => {
      published.push(variant.key);
      if (dependencies.reuseOnly === true) reuseOnly.push(variant.key);
      return { key: variant.key, object_key: `test/${variant.key}` };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(published, HISTORY_KEYS);
  assert.deepEqual(reuseOnly, HISTORY_KEYS);
  assert.equal(published.includes('dashboard'), false);
  assert.equal(published.includes('history:monthly'), false);
  assert.equal(result.track_history_steps, 0);
  assert.equal(result.track_history_result.reason, 'track-history-read-model-disabled');
  assert.deepEqual(result.published.map(({ key }) => key), HISTORY_KEYS);
});
