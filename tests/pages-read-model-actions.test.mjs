import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  materializedApiKey,
  materializedResponseCadenceSeconds,
  materializedResponseMaximumAge,
} from '../site/functions/lib/api-contract.js';
import { loadMaterializedSummary } from '../site/functions/lib/materialized-history.js';
import {
  dueVariantKeys,
  materializeVariant,
  runPagesReadModelActions,
} from '../worker/scripts/run-pages-read-model-actions.mjs';

const workflow = readFileSync(new URL('../.github/workflows/run-pages-read-model-rebuild.yml', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../worker/scripts/run-pages-read-model-actions.mjs', import.meta.url), 'utf8');
const materializedHistory = readFileSync(new URL('../site/functions/lib/materialized-history.js', import.meta.url), 'utf8');
const pagesMiddleware = readFileSync(new URL('../site/functions/_middleware.js', import.meta.url), 'utf8');
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
  assert.match(runner, /'r2', 'object', 'get'/);
  assert.match(runner, /source_revision/);
  assert.match(runner, /renderer_revision/);
  assert.doesNotMatch(materializedHistory, /sh_channel_snapshots/);
  assert.match(materializedHistory, /period_key<\?/);
  assert.match(d1Adapter, /'d1', 'execute', database/);
  assert.match(d1Adapter, /'--remote', '--yes', '--json'/);
  assert.match(runner, /r2', 'object', 'put'/);
  assert.match(r2Store, /pages-response\/actions-v2/);
  assert.doesNotMatch(r2Store, /pages-response\/actions-v1|LEGACY_ACTIONS_RESPONSE_KEY_PREFIX/);
  assert.match(r2Store, /TRACK_HISTORY_MODEL_KEY/);
  assert.match(r2Store, /x-api-source', 'actions-r2'/);
});

test('completed history uses R2 only while realtime dashboard may fall back live', () => {
  assert.match(pagesMiddleware, /const LIVE_PAGES_FALLBACK_MODEL_KEYS = new Set\(\['dashboard'\]\)/);
  assert.match(pagesMiddleware, /applyHistoryRange/);
  assert.match(responseFetch, /const R2_ONLY_MODEL_KEYS = new Set/);
  const r2OnlyStart = responseFetch.indexOf('if (R2_ONLY_MODEL_KEYS.has(modelKey))');
  const r2OnlyEnd = responseFetch.indexOf('} else if (modelKey === TRACK_HISTORY_MODEL_KEY)', r2OnlyStart);
  const r2OnlyBranch = responseFetch.slice(r2OnlyStart, r2OnlyEnd);
  assert.match(r2OnlyBranch, /response = await loadR2/);
  assert.doesNotMatch(r2OnlyBranch, /loadKv/);
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

test('historical range requests resolve to the canonical R2 model', () => {
  assert.equal(
    materializedApiKey('https://pages.test/api/history?mode=daily&from=2026-07-01&to=2026-07-19'),
    'history:daily',
  );
  assert.equal(
    materializedApiKey('https://pages.test/api/history?mode=broadcasts&from=2025-01-01'),
    'history:broadcasts',
  );
});

test('manual and main-push rebuilds can force every bounded model immediately', () => {
  assert.deepEqual(
    [...dueVariantKeys(DAY + 19 * MINUTE, { forceAll: true })],
    allMaterializedVariants(),
  );
});

test('materialized summaries exclude the current period from the R2 body', async () => {
  let sql;
  let bindings;
  const result = await loadMaterializedSummary({
    OTHER_DB: {
      prepare(value) {
        sql = value;
        const statement = {
          bind(...args) {
            bindings = args;
            return statement;
          },
          async all() { return { results: [] }; },
        };
        return statement;
      },
    },
  }, 'daily', '2024-06-01', '2026-07-20', DAY + 12 * 60 * MINUTE);

  assert.match(sql, /period_key<\?/);
  assert.deepEqual(bindings, ['2024-06-01', '2026-07-20', '2026-07-20', 800]);
  assert.deepEqual(result.rows, []);
  assert.equal(result.storage_source, 'other.sh_daily_summary');
});

test('unchanged historical input reuses the existing body without rerendering', async () => {
  const existing = {
    version: 1,
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    updated_at: DAY - MINUTE,
    cadence_seconds: 21600,
    source_revision: 'summary:daily:row_count=10:max_updated_at=123',
    renderer_revision: 'renderer-1',
    body: '{"ok":true,"rows":[]}',
  };
  let handlerCalls = 0;
  let uploaded;
  const result = await materializeVariant({
    key: 'history:daily',
    url: '/api/history?mode=daily',
  }, { OTHER_DB: {} }, DAY, {
    rendererRevision: 'renderer-1',
    loadExistingEnvelope: async () => existing,
    loadSourceRevision: async () => existing.source_revision,
    responseHandler: async () => {
      handlerCalls += 1;
      throw new Error('unchanged model must not rerender');
    },
    uploadEnvelope(key, envelope) {
      uploaded = { key, envelope };
      return 'pages-response/test.json';
    },
  });

  assert.equal(handlerCalls, 0);
  assert.equal(result.rendered, false);
  assert.equal(result.changed, false);
  assert.equal(result.object_key, 'pages-response/test.json');
  assert.equal(uploaded.key, 'history:daily');
  assert.equal(uploaded.envelope.body, existing.body);
  assert.equal(uploaded.envelope.updated_at, DAY);
});

test('renderer changes force a fresh read model even when source rows are unchanged', async () => {
  let handlerCalls = 0;
  const result = await materializeVariant({
    key: 'history:daily',
    url: '/api/history?mode=daily',
  }, { OTHER_DB: {} }, DAY, {
    rendererRevision: 'renderer-2',
    loadExistingEnvelope: async () => ({
      version: 1,
      source_revision: 'same-source',
      renderer_revision: 'renderer-1',
      body: '{"ok":true}',
    }),
    loadSourceRevision: async () => 'same-source',
    responseHandler: async () => {
      handlerCalls += 1;
      return async () => new Response('{"ok":true,"rows":[]}', {
        headers: { 'content-type': 'application/json' },
      });
    },
    uploadEnvelope() { return 'pages-response/test.json'; },
  });
  assert.equal(handlerCalls, 1);
  assert.equal(result.rendered, true);
  assert.equal(result.renderer_revision, 'renderer-2');
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
