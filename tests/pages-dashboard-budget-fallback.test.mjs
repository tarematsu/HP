import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BUDGET_SAFE_VARIANTS,
  DASHBOARD_ONLY_VARIANTS,
  refreshPagesDashboardActions,
} from '../worker/scripts/refresh-pages-dashboard-actions.mjs';

const workflow = readFileSync(
  new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url),
  'utf8',
);

const NOW = Date.UTC(2026, 6, 28, 0, 4);
const SAFE_KEYS = [
  'dashboard',
  'history:daily',
  'history:weekly',
  'history:monthly',
  'history:broadcasts',
  'host-history:summary',
];

test('D1 budget deferral still publishes dashboard and bounded summaries', () => {
  assert.match(workflow, /name: Record D1 budget deferral/);
  assert.match(workflow, /name: Install Worker dependencies\n        run: npm ci/);
  assert.match(workflow, /name: Refresh budget-safe read models during D1 budget deferral/);
  assert.match(
    workflow,
    /if: steps\.d1-write-budget\.outputs\.allowed != 'true'[\s\S]*node scripts\/refresh-pages-dashboard-actions\.mjs/,
  );
  assert.match(
    workflow,
    /name: Rebuild track history and publish due variants\n        if: steps\.d1-write-budget\.outputs\.allowed == 'true'/,
  );
  assert.match(workflow, /bounded dashboard and summary refresh will still run\./);
  assert.match(workflow, /site\/functions\/lib\/materialized-history\.js/);
});

test('budget fallback publishes safe summaries but cannot execute track-history work', async () => {
  assert.deepEqual(DASHBOARD_ONLY_VARIANTS.map(({ key }) => key), ['dashboard']);
  assert.deepEqual(BUDGET_SAFE_VARIANTS.map(({ key }) => key), SAFE_KEYS);
  const published = [];
  const result = await refreshPagesDashboardActions({
    startedAt: NOW,
    deadlineMs: NOW + 60_000,
    now: () => NOW,
    env: { MINUTE_DB: {}, DB: {}, BUDDIES_DB: {}, OTHER_DB: {} },
    materializeVariant: async (variant) => {
      published.push(variant.key);
      return { key: variant.key, object_key: `test/${variant.key}` };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(published, SAFE_KEYS);
  assert.equal(result.track_history_steps, 1);
  assert.equal(result.track_history_result.reason, 'budget-safe-summary-fallback');
  assert.deepEqual(result.published.map(({ key }) => key), SAFE_KEYS);
});
