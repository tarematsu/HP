import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  materializedApiKey,
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

function allMaterializedVariants() {
  return [
    'dashboard',
    'history:daily',
    'history:weekly',
    'history:monthly',
    'history:broadcasts',
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

test('pages read models run independently before runtime maintenance', () => {
  assert.match(workflow, /cron: '26,56 \* \* \* \*'/);
  assert.doesNotMatch(workflow, /workflow_run:/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /group: pages-read-model-rebuild/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /PAGES_RESPONSE_BUCKET/);
  assert.match(workflow, /PAGES_READ_MODEL_FORCE_ALL/);
  assert.doesNotMatch(workflow, /PAGES_READ_MODEL_MAX_STEPS|Rebuild track history/);
  assert.match(workflow, /Publish due pages read models/);
  assert.match(workflow, /run-pages-read-model-actions\.mjs/);
  assert.match(runner, /export async function runPagesReadModelActions/);
  assert.doesNotMatch(runner, /runSplitTrackHistoryCycleStep|MAX_TRACK_HISTORY_STEPS|while \(steps < maxSteps/);
  assert.match(runner, /variant\.cadence_minutes/);
  assert.match(runner, /HISTORY_REFRESH_PHASE_MINUTES = 26/);
  assert.match(runner, /scheduledSlotMinute/);
  assert.match(runner, /materialized-history\.js/);
  assert.match(runner, /track-history-read-model-disabled/);
  assert.doesNotMatch(materializedHistory, /sh_channel_snapshots/);
  assert.match(d1Adapter, /'d1', 'execute', database/);
  assert.match(d1Adapter, /'--remote', '--yes', '--json'/);
  assert.match(runner, /r2', 'object', 'put'/);
  assert.match(r2Store, /pages-response\/actions-v2/);
  assert.match(r2Store, /LEGACY_ACTIONS_RESPONSE_KEY_PREFIX/);
  assert.match(r2Store, /x-api-source', 'actions-r2'/);
});

test('dashboard materialized lifetime covers the 30-minute Actions publication interval', () => {
  assert.equal(materializedResponseCadenceSeconds('dashboard'), 30 * 60);
  assert.equal(materializedResponseMaximumAge('dashboard'), 35 * MINUTE);
});

test('contract cadence follows the actual :26/:56 workflow slots', () => {
  assert.deepEqual([...dueVariantKeys(DAY + 26 * MINUTE)], allMaterializedVariants());
  assert.deepEqual([...dueVariantKeys(DAY + 55 * MINUTE)], allMaterializedVariants());
  assert.deepEqual([...dueVariantKeys(DAY + 56 * MINUTE)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(DAY + 86 * MINUTE)], ['dashboard']);
  assert.deepEqual([...dueVariantKeys(DAY + 386 * MINUTE)], sixHourVariants());
  assert.deepEqual([...dueVariantKeys(DAY + 1466 * MINUTE)], allMaterializedVariants());
  assert.equal(materializedApiKey('https://pages.test/api/track-history'), null);
});

test('manual and main-push rebuilds can force every bounded model immediately', () => {
  assert.deepEqual(
    [...dueVariantKeys(DAY + 19 * MINUTE, { forceAll: true })],
    allMaterializedVariants(),
  );
});

test('runner materializes only due variants and never advances track history', async () => {
  const published = [];
  let trackCalls = 0;
  const result = await runPagesReadModelActions({
    startedAt: DAY + 19 * MINUTE,
    deadlineMs: DAY + 30 * MINUTE,
    now: () => DAY + 19 * MINUTE,
    env: { MINUTE_DB: {}, DB: {}, BUDDIES_DB: {}, OTHER_DB: {} },
    runTrackHistoryStep: async () => { trackCalls += 1; },
    materializeVariant: async (variant) => {
      published.push(variant.key);
      return { key: variant.key, object_key: `test/${variant.key}` };
    },
  });
  assert.equal(trackCalls, 0);
  assert.equal(result.track_history_steps, 0);
  assert.equal(result.track_history_deferred, false);
  assert.equal(result.track_history_result.reason, 'track-history-read-model-disabled');
  assert.deepEqual(published, ['dashboard']);
  assert.equal(result.published[0].key, 'dashboard');
});

test('runner publishes all due non-track variants', async () => {
  const published = [];
  const result = await runPagesReadModelActions({
    startedAt: DAY + 26 * MINUTE,
    deadlineMs: DAY + 40 * MINUTE,
    now: () => DAY + 26 * MINUTE,
    env: { MINUTE_DB: {}, DB: {}, BUDDIES_DB: {}, OTHER_DB: {} },
    materializeVariant: async (variant) => {
      published.push(variant.key);
      return { key: variant.key };
    },
  });
  assert.deepEqual(published, allMaterializedVariants());
  assert.equal(result.event, 'pages_read_model_actions_complete');
  assert.equal(result.track_history_steps, 0);
});

test('runner force-all mode republishes every bounded model outside a scheduled slot', async () => {
  const published = [];
  const result = await runPagesReadModelActions({
    startedAt: DAY + 19 * MINUTE,
    deadlineMs: DAY + 40 * MINUTE,
    now: () => DAY + 19 * MINUTE,
    forceAll: true,
    env: { MINUTE_DB: {}, DB: {}, BUDDIES_DB: {}, OTHER_DB: {} },
    materializeVariant: async (variant) => {
      published.push(variant.key);
      return { key: variant.key };
    },
  });
  assert.equal(result.force_all, true);
  assert.deepEqual(published, allMaterializedVariants());
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
