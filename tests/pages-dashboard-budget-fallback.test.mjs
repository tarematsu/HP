import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BUDGET_SAFE_VARIANTS,
  DASHBOARD_ONLY_VARIANTS,
  REUSE_ONLY_VARIANTS,
  refreshPagesDashboardActions,
} from '../worker/scripts/refresh-pages-dashboard-actions.mjs';

const workflow = readFileSync(
  new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url),
  'utf8',
);

const NOW = Date.UTC(2026, 6, 28, 0, 4);
const SAFE_KEYS = ['dashboard'];
const REUSE_ONLY_KEYS = [
  'history:daily',
  'history:weekly',
  'history:monthly',
  'history:broadcasts',
  'host-history:summary',
];

test('D1 budget deferral refreshes dashboard and only reuses unchanged history', () => {
  assert.match(workflow, /name: Record D1 budget deferral/);
  assert.match(workflow, /name: Install Worker dependencies\n        run: npm ci/);
  assert.match(workflow, /name: Refresh dashboard and reusable history models during D1 budget deferral/);
  assert.match(
    workflow,
    /if: steps\.d1-write-budget\.outputs\.read_allowed != 'true'[\s\S]*node scripts\/refresh-pages-dashboard-actions\.mjs/,
  );
  assert.match(
    workflow,
    /name: Publish due pages read models\n        if: steps\.d1-write-budget\.outputs\.read_allowed == 'true'/,
  );
  assert.match(workflow, /dashboard refresh and reuse-only history freshness checks will still run\./);
  assert.match(workflow, /site\/functions\/lib\/materialized-history\.js/);
  assert.doesNotMatch(workflow, /Rebuild track history|track-history generation/);
});

test('budget fallback publishes dashboard and keeps history reuse-only', async () => {
  assert.deepEqual(DASHBOARD_ONLY_VARIANTS.map(({ key }) => key), ['dashboard']);
  assert.deepEqual(BUDGET_SAFE_VARIANTS.map(({ key }) => key), [...SAFE_KEYS, ...REUSE_ONLY_KEYS]);
  assert.deepEqual(REUSE_ONLY_VARIANTS.map(({ key }) => key), REUSE_ONLY_KEYS);
  const published = [];
  const reuseOnly = [];
  const result = await refreshPagesDashboardActions({
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
  assert.deepEqual(published, [...SAFE_KEYS, ...REUSE_ONLY_KEYS]);
  assert.deepEqual(reuseOnly, REUSE_ONLY_KEYS);
  assert.equal(result.track_history_steps, 0);
  assert.equal(result.track_history_result.reason, 'track-history-read-model-disabled');
  assert.deepEqual(result.published.map(({ key }) => key), [...SAFE_KEYS, ...REUSE_ONLY_KEYS]);
});
