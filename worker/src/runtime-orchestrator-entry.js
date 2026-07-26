import './fetch-guard.js';

import { budgetedLiveCompleteMessage } from './minute-live-complete-message.js';

const EMPTY_DEPENDENCIES = Object.freeze({});
const LIVE_DERIVE_QUEUE_NAME = 'stationhead-minute-live-derive';
const ENRICHMENT_QUEUE_NAMES = new Set([
  'stationhead-minute-enrichment',
  'stationhead-track-metadata',
]);

let enrichmentModulePromise;
let pagesResponseModulePromise;
let runtimeQueueModulePromise;
let liveTriggerModulePromise;
let liveRevisionModulePromise;
let liveWriteModulePromise;
let liveCompleteModulePromise;

function enabled(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.trunc(parsed) > 0 ? Math.trunc(parsed) : null;
}

function liveRevisionMaterializationEnabled(env = {}) {
  const value = env?.LIVE_REVISION_MATERIALIZATION_ENABLED;
  if (value == null || value === '') return enabled(env?.HISTORICAL_REBUILD_ENABLED, true);
  return enabled(value, true);
}

function lightweightLiveMessageKind(body) {
  if (body?.message_type === 'minute-fact-derive'
      && Number(body?.message_version) === 1
      && String(body?.job_kind || 'live') !== 'rebuild') return 'trigger';
  if (body?.message_type !== 'minute-fact-derive-stage'
      || Number(body?.message_version) !== 1) return null;
  if (body?.stage === 'revision-materialize'
      && body?.revision?.sparse === true
      && body?.revision?.rebuild !== true
      && positiveInteger(body?.revision?.revision_id) != null) return 'revision';
  if ((body?.stage === 'write' || body?.stage === 'budget-live-write')
      && positiveInteger(body?.job?.id) != null
      && body?.payload?.rebuild !== true
      && String(body?.job?.job_kind || 'live') !== 'rebuild') return 'write';
  if (budgetedLiveCompleteMessage(body)) return 'complete';
  return null;
}

export function lightweightLiveBudgetKind(batch, env) {
  if (String(batch?.queue || '') !== LIVE_DERIVE_QUEUE_NAME) return null;
  if (liveRevisionMaterializationEnabled(env)) return null;
  const messages = batch?.messages || [];
  if (!messages.length) return null;
  const kind = lightweightLiveMessageKind(messages[0]?.body);
  if (!kind) return null;
  return messages.every((message) => lightweightLiveMessageKind(message?.body) === kind)
    ? kind
    : null;
}

export function lightweightLiveCompleteBatch(batch, env) {
  return lightweightLiveBudgetKind(batch, env) === 'complete';
}

function loadEnrichmentModule() {
  enrichmentModulePromise ||= import('./minute-enrichment-optimized-entry.js');
  return enrichmentModulePromise;
}

function loadPagesResponseModule() {
  pagesResponseModulePromise ||= import('./pages-response-fetch-entry.js');
  return pagesResponseModulePromise;
}

function loadRuntimeQueueModule() {
  runtimeQueueModulePromise ||= import('./runtime-queue.js');
  return runtimeQueueModulePromise;
}

function loadLiveTriggerModule() {
  liveTriggerModulePromise ||= import('./minute-live-trigger-budget-entry.js');
  return liveTriggerModulePromise;
}

function loadLiveRevisionModule() {
  liveRevisionModulePromise ||= import('./minute-live-revision-budget-entry.js');
  return liveRevisionModulePromise;
}

function loadLiveWriteModule() {
  liveWriteModulePromise ||= import('./minute-live-write-budget-entry.js');
  return liveWriteModulePromise;
}

function loadLiveCompleteModule() {
  liveCompleteModulePromise ||= import('./minute-live-complete-budget-entry.js');
  return liveCompleteModulePromise;
}

async function runLightweightLiveQueue(kind, batch, env, dependencies) {
  if (kind === 'complete') {
    const run = dependencies.runLiveCompleteQueue
      || (await loadLiveCompleteModule()).processBudgetedLiveCompleteBatch;
    return run(batch, env, dependencies.liveComplete || EMPTY_DEPENDENCIES);
  }
  if (kind === 'trigger') {
    const run = dependencies.runLiveTriggerQueue
      || (await loadLiveTriggerModule()).processBudgetedLiveTriggerBatch;
    return run(batch, env, dependencies.liveTrigger || EMPTY_DEPENDENCIES);
  }
  if (kind === 'revision') {
    const run = dependencies.runLiveRevisionQueue
      || (await loadLiveRevisionModule()).processBudgetedLiveRevisionBatch;
    return run(batch, env, dependencies.liveRevision || EMPTY_DEPENDENCIES);
  }
  const run = dependencies.runLiveWriteQueue
    || (await loadLiveWriteModule()).processBudgetedLiveWriteBatch;
  return run(batch, env, dependencies.liveWrite || EMPTY_DEPENDENCIES);
}

export async function runCoreQueue(batch, env, ctx, dependencies = EMPTY_DEPENDENCIES) {
  const queueName = String(batch?.queue || '');
  if (ENRICHMENT_QUEUE_NAMES.has(queueName)) {
    const run = dependencies.runEnrichmentQueue
      || (await loadEnrichmentModule()).processMinuteEnrichmentBatch;
    return run(batch, env, dependencies.enrichment || EMPTY_DEPENDENCIES);
  }
  const liveKind = lightweightLiveBudgetKind(batch, env);
  if (liveKind) return runLightweightLiveQueue(liveKind, batch, env, dependencies);
  const run = dependencies.runRuntimeQueue || (await loadRuntimeQueueModule()).runRuntimeQueue;
  return run(batch, env, ctx, dependencies.runtime || EMPTY_DEPENDENCIES);
}

export async function runCoreFetch(request, env, ctx, dependencies = EMPTY_DEPENDENCIES) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/internal/minute-runtime-state') {
    const read = dependencies.readMinuteRuntimeState
      || (await import('./minute-facts-runtime-state.js')).readMinuteFactRuntimeState;
    const tasks = await read(env);
    return Response.json({
      ok: Array.isArray(tasks),
      service: 'sh-runtime-orchestrator',
      tasks: Array.isArray(tasks) ? tasks : [],
      checked_at: Date.now(),
    }, {
      headers: { 'cache-control': 'no-store' },
    });
  }
  const run = dependencies.runPagesFetch
    || (await loadPagesResponseModule()).runPagesResponseFetch;
  return run(request, env, ctx, dependencies.pages || EMPTY_DEPENDENCIES);
}

export { ENRICHMENT_QUEUE_NAMES };

export default {
  fetch: runCoreFetch,
  queue: runCoreQueue,
};
