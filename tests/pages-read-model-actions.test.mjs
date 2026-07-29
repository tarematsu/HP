import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  materializedResponseCadenceSeconds,
  materializedResponseMaximumAge,
} from '../site/functions/lib/api-contract.js';
import {
  dueVariantKeys,
  runPagesReadModelActions,
} from '../worker/scripts/run-pages-read-model-actions.mjs';

const workflow = readFileSync(new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../worker/scripts/run-pages-read-model-actions.mjs', import.meta.url), 'utf8');
const materializedHistory = readFileSync(new URL('../site/functions/lib/materialized-history.js', import.meta.url), 'utf8');
const d1Adapter = readFileSync(new URL('../worker/scripts/remote-d1-adapter.mjs', import.meta.url), 'utf8');
const deployedEntry = readFileSync(new URL('../worker/src/runtime-orchestrator-deployed-entry.js', import.meta.url), 'utf8');
const runtimeEntry = readFileSync(new URL('../worker/src/runtime-orchestrator-entry.js', import.meta.url), 'utf8');
const responseFetch = readFileSync(new URL('../worker/src/pages-response-fetch-entry.js', import.meta.url), 'utf8');
const r2Store = readFileSync(new URL('../worker/src/pages-response-r2.js', import.meta.url), 'utf8');
const runtime = JSON.parse(readFileSync(new URL('../worker/wrangler.runtime.jsonc', import.meta.url), 'utf8'));

const DAY = Date.UTC(2026, 6, 20);
const MINUTE = 60_000;

function allHistoryVariants() {
  return [
    'dashboard',
    'history:daily',
    'history:weekly',
    'history:monthly',
    'history:broadcasts',
    'track-history',
    'host-history:summary',
  ];
}

function sixHourVariants() {
  return [
    'dashboard',
    'history:daily',
    'history:weekly',
    'history:monthly',
    'history:broadcasts',
  ];
}

test('pages read models run independently before chaining runtime maintenance', () => {
  assert.match(workflow, /cron: '26,56 \* \* \* \*'/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /group: pages-read-model-rebuild/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /PAGES_RESPONSE_BUCKET/);
  assert.match(workflow, /PAGES_READ_MODEL_MAX_STEPS: '4'/);
  assert.match(workflow, /run-pages-read-model-actions\.mjs/);
  assert.match(runner, /export async function runPagesReadModelActions/);
  assert.match(runner, /runSplitTrackHistoryCycleStep/);
  assert.match(runner, /MAX_TRACK_HISTORY_STEPS = 16/);
  assert.match(runner, /variant\.cadence_minutes/);
  assert.match(runner, /materialized-history\.js/);
  assert.match(runner, /while \(steps < maxSteps && Number\(clock\(\)\) < deadlineMs\)/);
  assert.match(runner, /pages_read_model_actions_deferred/);
  assert.match(runner, /variant\.key !== 'track-history'/);
  assert.doesNotMatch(materializedHistory, /sh_channel_snapshots/);
  assert.match(d1Adapter, /'d1', 'execute', database/);
  assert.match(d1Adapter, /'--remote', '--yes', '--json'/);
  assert.match(runner, /r2', 'object', 'put'/);
  assert.match(r2Store, /pages-response\/actions-v1/);
  assert.match(r2Store, /x-api-source', 'actions-r2'/);
});

test('dashboard materialized lifetime covers the 30-minute Actions publication interval', () => {
  assert.equal(materializedResponseCadenceSeconds('dashboard'), 30 * 60);
  assert.equal(materializedResponseMaximumAge('dashboard'), 35 * MINUTE);
});

test('contract cadence regenerates histories every six hours and archives daily', () => {
  assert.deepEqual([...dueVariantKeys(DAY + 4 * MINUTE)], allHistoryVariants());
  assert.deepEqual([...dueVariantKeys(DAY + 19 * MINUTE)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(DAY + 64 * MINUTE)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(DAY + 364 * MINUTE)], sixHourVariants());
  assert.deepEqual([...dueVariantKeys(DAY + 1444 * MINUTE)], allHistoryVariants());
});

test('runner completes a published track-history generation and materializes only due variants', async () => {
  const published = [];
  const result = await runPagesReadModelActions({
    startedAt: DAY + 19 * MINUTE,
    deadlineMs: DAY + 30 * MINUTE,
    now: () => DAY + 19 * MINUTE,
    env: { MINUTE_DB: {}, DB: {}, BUDDIES_DB: {}, OTHER_DB: {} },
    runTrackHistoryStep: async () => ({ reason: 'track-history-cycle-already-published' }),
    materializeVariant: async (variant) => {
      published.push(variant.key);
      return { key: variant.key, object_key: `test/${variant.key}` };
    },
  });
  assert.equal(result.track_history_steps, 1);
  assert.equal(result.track_history_deferred, false);
  assert.deepEqual(published, ['dashboard']);
  assert.equal(result.published[0].key, 'dashboard');
});

test('runner publishes track-history immediately when the generation completes', async () => {
  const published = [];
  const result = await runPagesReadModelActions({
    startedAt: DAY + 19 * MINUTE,
    deadlineMs: DAY + 30 * MINUTE,
    now: () => DAY + 19 * MINUTE,
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
  assert.equal(result.track_history_deferred, false);
});

test('runner refreshes dashboard and safely defers an incomplete track-history rebuild', async () => {
  const events = [];
  const result = await runPagesReadModelActions({
    startedAt: DAY + 19 * MINUTE,
    deadlineMs: DAY + 30 * MINUTE,
    now: () => DAY + 19 * MINUTE,
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
  });
  assert.equal(result.ok, true);
  assert.equal(result.event, 'pages_read_model_actions_deferred');
  assert.equal(result.track_history_steps, 2);
  assert.equal(result.track_history_deferred, true);
  assert.equal(result.track_history_defer_reason, 'step-budget');
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
