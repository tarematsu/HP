import { pendingMinuteDeriveTriggers } from './minute-derive-trigger.js';
import {
  markSparseRevisionRecoveryDispatched,
  pendingSparseRevisionTasks,
} from './minute-revision-recovery.js';

const EMPTY_DEPENDENCIES = Object.freeze({});
const JSON_QUEUE_SEND_OPTIONS = Object.freeze({ contentType: 'json' });
const DERIVE_STATE_CHECKPOINT_MS = 20 * 60_000;
const DERIVE_POLL_INTERVAL_MS = 5 * 60_000;
let deriveDispatchStateDependenciesPromise = null;

function defaultDeriveDispatchStateDependencies() {
  deriveDispatchStateDependenciesPromise ||= Promise.all([
    import('./minute-facts-inbox-health.js'),
    import('./minute-facts-runtime-state.js'),
  ]).then(([inboxModule, runtimeModule]) => ({
    stats: inboxModule.minuteFactInboxHealth,
    record: runtimeModule.recordMinuteFactRuntimeState,
  }));
  return deriveDispatchStateDependenciesPromise;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function deriveDispatchStateCheckpointDue(now = Date.now()) {
  const currentWindow = Math.floor(Number(now) / DERIVE_STATE_CHECKPOINT_MS);
  const previousPollWindow = Math.floor((Number(now) - DERIVE_POLL_INTERVAL_MS) / DERIVE_STATE_CHECKPOINT_MS);
  return currentWindow !== previousPollWindow;
}

async function recordDeriveDispatchState(env, summary, startedAt, dependencies = EMPTY_DEPENDENCIES) {
  if (!env?.MINUTE_DB) return false;
  const dispatched = Number(summary?.dispatched || 0) + Number(summary?.revision_recoveries || 0);
  if (dispatched <= 0 && !deriveDispatchStateCheckpointDue(startedAt)) {
    summary.state_checkpoint_skipped = true;
    return false;
  }
  let stats = dependencies.stats;
  let record = dependencies.record;
  if (!stats || !record) {
    const defaults = await defaultDeriveDispatchStateDependencies();
    stats ||= defaults.stats;
    record ||= defaults.record;
  }
  let snapshot = {};
  try { snapshot = await stats(env); } catch {}
  Object.assign(summary, snapshot);
  await record(env, 'derive', {
    processed: 0,
    failed: 0,
    ...snapshot,
  }, { startedAt });
  return true;
}

function offlineRevision(message) {
  if (message?.revision?.rebuild === true) return true;
  const rawKind = message?.job_kind ?? message?.job?.job_kind;
  if (rawKind == null || rawKind === '') return false;
  return String(rawKind).toLowerCase() !== 'live';
}

async function sendQueueMessages(queue, messages) {
  if (!messages.length) return;
  if (!queue?.send && typeof queue?.sendBatch !== 'function') {
    throw new Error('MINUTE_LIVE_DERIVE_QUEUE binding is missing');
  }
  if (typeof queue.sendBatch === 'function') {
    await queue.sendBatch(messages.map((body) => ({ body, contentType: 'json' })));
    return;
  }
  await Promise.all(messages.map((body) => queue.send(body, JSON_QUEUE_SEND_OPTIONS)));
}

export async function dispatchPendingMinuteFacts(env, dependencies = EMPTY_DEPENDENCIES, ctx = null) {
  const queue = env?.MINUTE_LIVE_DERIVE_QUEUE;
  if (!queue?.send && typeof queue?.sendBatch !== 'function') {
    throw new Error('MINUTE_LIVE_DERIVE_QUEUE binding is missing');
  }
  const startedAt = Number(dependencies.now) || Date.now();
  const loadFacts = dependencies.load || pendingMinuteDeriveTriggers;
  const loadRevisions = dependencies.loadRevisionRecovery || pendingSparseRevisionTasks;
  const factLimit = positiveInteger(env.DERIVE_DISPATCH_LIMIT, 5, 20);
  const recoveryLimit = positiveInteger(env.DERIVE_REVISION_RECOVERY_LIMIT, 1, 5);
  const [triggers, revisionRecoveries] = await Promise.all([
    loadFacts(env, { limit: factLimit }),
    loadRevisions(env, { limit: recoveryLimit, now: startedAt }),
  ]);
  const liveTriggers = triggers.filter((message) => !offlineRevision(message));
  const liveRecoveries = revisionRecoveries.filter((message) => !offlineRevision(message));
  await sendQueueMessages(queue, [...liveTriggers, ...liveRecoveries]);
  if (liveRecoveries.length) {
    const mark = dependencies.markRevisionRecovery || markSparseRevisionRecoveryDispatched;
    await mark(env, liveRecoveries.map((message) => message?.revision?.revision_id), startedAt);
  }
  const retiredOffline = triggers.length + revisionRecoveries.length
    - liveTriggers.length - liveRecoveries.length;
  const summary = {
    event: 'minute_live_derive_recovery_dispatch',
    dispatched: liveTriggers.length,
    revision_recoveries: liveRecoveries.length,
    live_messages: liveTriggers.length + liveRecoveries.length,
    retired_offline_messages: retiredOffline,
    rebuild_messages: 0,
    limit: factLimit,
    recovery_limit: recoveryLimit,
  };
  const stateTask = recordDeriveDispatchState(env, summary, startedAt, dependencies).catch((error) => {
    console.warn(JSON.stringify({
      event: 'minute_derive_dispatch_state_failed',
      error: String(error?.message || error).slice(0, 800),
    }));
  });
  if (typeof ctx?.waitUntil === 'function') ctx.waitUntil(stateTask);
  else await stateTask;
  console.log(JSON.stringify(summary));
  return summary;
}
