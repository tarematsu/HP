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

const NOW = Date.UTC(2026, 6, 28, 0, 4);
const HISTORY_KEYS = [
  'history:daily',
  'history:weekly',
  'history:broadcasts',
  'host-history:summary',
];

test('Pages history publication has no D1 budget guard', () => {
  assert.doesNotMatch(workflow, /cloudflare-d1-write-guard\.mjs/);
  assert.doesNotMatch(workflow, /D1_ACTIONS_READ_ROWS_PER_DAY_LIMIT/);
  assert.doesNotMatch(workflow, /D1_ACTIONS_WRITE_ROWS_PER_HOUR_LIMIT/);
  assert.doesNotMatch(workflow, /PAGES_READ_MODEL_REUSE_ONLY/);
  assert.doesNotMatch(workflow, /Record D1 budget deferral/);
  assert.doesNotMatch(workflow, /Refresh reusable history models during D1 budget deferral/);
  assert.match(workflow, /name: Publish due pages read models/);
  assert.match(workflow, /node scripts\/run-pages-history-read-model-actions\.mjs/);
  assert.match(workflow, /name: Publish compact track ranking to R2/);
  assert.match(workflow, /name: Remove retired monthly history read model/);
  assert.doesNotMatch(workflow, /node scripts\/refresh-pages-dashboard-actions\.mjs/);
  assert.doesNotMatch(workflow, /node scripts\/refresh-pages-realtime-actions\.mjs/);
  assert.doesNotMatch(workflow, /Rebuild track history|track-history generation/);
});

test('history runner ignores reuse-only budget inputs and always renders due variants', async () => {
  assert.deepEqual(HISTORY_READ_MODEL_VARIANTS.map(({ key }) => key), HISTORY_KEYS);
  const published = [];
  const reuseOnly = [];
  const result = await runPagesHistoryReadModelActions({
    reuseOnly: true,
    reuseOnlyKeys: HISTORY_KEYS,
    dueKeys: HISTORY_KEYS,
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
  assert.deepEqual(reuseOnly, []);
  assert.equal(published.includes('spotify-playcounts'), false);
  assert.equal(published.includes('dashboard'), false);
  assert.equal(published.includes('history:monthly'), false);
  assert.equal(result.track_history_steps, 0);
  assert.equal(result.track_history_result.reason, 'track-history-read-model-disabled');
  assert.deepEqual(result.published.map(({ key }) => key), HISTORY_KEYS);
});
