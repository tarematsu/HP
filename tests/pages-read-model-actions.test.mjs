import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  dueVariantKeys,
  runPagesReadModelActions,
} from '../worker/scripts/run-pages-read-model-actions.mjs';

const workflow = readFileSync(new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../worker/scripts/run-pages-read-model-actions.mjs', import.meta.url), 'utf8');
const d1Adapter = readFileSync(new URL('../worker/scripts/remote-d1-adapter.mjs', import.meta.url), 'utf8');
const deployedEntry = readFileSync(new URL('../worker/src/runtime-orchestrator-deployed-entry.js', import.meta.url), 'utf8');
const runtimeEntry = readFileSync(new URL('../worker/src/runtime-orchestrator-entry.js', import.meta.url), 'utf8');
const responseFetch = readFileSync(new URL('../worker/src/pages-response-fetch-entry.js', import.meta.url), 'utf8');
const r2Store = readFileSync(new URL('../worker/src/pages-response-r2.js', import.meta.url), 'utf8');
const runtime = JSON.parse(readFileSync(new URL('../worker/wrangler.runtime.jsonc', import.meta.url), 'utf8'));

const DAY = Date.UTC(2026, 6, 20);

test('pages read models rebuild frequently in one bounded Actions job', () => {
  assert.match(workflow, /cron: '4,19,34,49 \* \* \* \*'/);
  assert.match(workflow, /group: pages-read-model-rebuild/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /PAGES_RESPONSE_BUCKET/);
  assert.match(workflow, /run-pages-read-model-actions\.mjs/);
  assert.match(runner, /export async function runPagesReadModelActions/);
  assert.match(runner, /runSplitTrackHistoryCycleStep/);
  assert.match(runner, /while \(steps < maxSteps && Number\(clock\(\)\) < deadlineMs\)/);
  assert.match(runner, /variant\.key !== 'track-history'/);
  assert.match(runner, /createWranglerRemoteD1/);
  assert.match(d1Adapter, /'d1', 'execute', database/);
  assert.match(d1Adapter, /'--remote', '--yes', '--json'/);
  assert.match(runner, /r2', 'object', 'put'/);
  assert.match(r2Store, /pages-response\/actions-v1/);
  assert.match(r2Store, /x-api-source', 'actions-r2'/);
});

test('tiered cadence regenerates only the due variants', () => {
  assert.deepEqual([...dueVariantKeys(DAY + 4 * 60_000)], [
    'dashboard',
    'history:daily',
    'history:weekly',
    'history:broadcasts',
    'history:monthly',
    'host-history:summary',
    'track-history',
  ]);
  assert.deepEqual([...dueVariantKeys(DAY + 19 * 60_000)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(DAY + 64 * 60_000)], ['dashboard', 'history:daily']);
});

test('runner completes a published track-history generation and materializes only due variants', async () => {
  const published = [];
  const result = await runPagesReadModelActions({
    startedAt: DAY + 19 * 60_000,
    deadlineMs: DAY + 30 * 60_000,
    now: () => DAY + 19 * 60_000,
    env: { MINUTE_DB: {}, DB: {}, BUDDIES_DB: {}, OTHER_DB: {} },
    runTrackHistoryStep: async () => ({ reason: 'track-history-cycle-already-published' }),
    materializeVariant: async (variant) => {
      published.push(variant.key);
      return { key: variant.key, object_key: `test/${variant.key}` };
    },
  });
  assert.equal(result.track_history_steps, 1);
  assert.deepEqual(published, ['dashboard']);
  assert.equal(result.published[0].key, 'dashboard');
});

test('runner publishes track-history immediately when the generation completes', async () => {
  const published = [];
  const result = await runPagesReadModelActions({
    startedAt: DAY + 19 * 60_000,
    deadlineMs: DAY + 30 * 60_000,
    now: () => DAY + 19 * 60_000,
    env: { MINUTE_DB: {}, DB: {}, BUDDIES_DB: {}, OTHER_DB: {} },
    runTrackHistoryStep: async () => ({
      task: { kind: 'track-history-published' },
      stage: { published: true },
      publication: { published: true, phase: 'published' },
    }),
    materializeVariant: async (variant) => {
      published.push(variant.key);
      return { key: variant.key };
    },
  });
  assert.deepEqual(published, ['dashboard', 'track-history']);
  assert.equal(result.track_history_result.publication.published, true);
});

test('runner refreshes dashboard before reporting an incomplete track-history rebuild', async () => {
  const events = [];
  await assert.rejects(runPagesReadModelActions({
    startedAt: DAY + 19 * 60_000,
    deadlineMs: DAY + 30 * 60_000,
    now: () => DAY + 19 * 60_000,
    maxSteps: 2,
    env: { MINUTE_DB: {}, DB: {}, BUDDIES_DB: {}, OTHER_DB: {} },
    runTrackHistoryStep: async () => {
      events.push('track-history-step');
      return { stage: { published: false } };
    },
    materializeVariant: async (variant) => {
      events.push(`publish:${variant.key}`);
      return { key: variant.key };
    },
  }), /did not finish within 2 steps/);
  assert.deepEqual(events, [
    'publish:dashboard',
    'track-history-step',
    'track-history-step',
  ]);
});

test('runtime serves materialized responses through a serving-only module', () => {
  assert.equal(runtime.triggers, undefined);
  assert.equal(Object.hasOwn(runtime.vars, 'PAGES_TRACK_HISTORY_CYCLE_ENABLED'), false);
  assert.doesNotMatch(deployedEntry, /scheduled\s*:|runRuntimeOrchestratorScheduled/);
  assert.match(runtimeEntry, /pages-response-fetch-entry\.js/);
  assert.match(runtimeEntry, /runPagesResponseFetch/);
  assert.doesNotMatch(runtimeEntry, /pages-read-model-entry|runPagesReadModelCron|runCoreScheduled|pagesScheduledDue/);
  assert.match(responseFetch, /loadMaterializedR2Response/);
  assert.match(responseFetch, /loadMaterializedResponse/);
  assert.doesNotMatch(responseFetch, /pages-read-model-dispatch|track-history-publication|PAGES_READ_MODEL_QUEUE/);
});
