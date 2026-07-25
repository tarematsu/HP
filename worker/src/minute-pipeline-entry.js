import { historicalRebuildEnabled } from './historical-rebuild-policy.js';
import {
  budgetedLiveCompleteMessage,
  processBudgetedLiveCompleteBatch,
} from './minute-live-complete-budget-entry.js';
import {
  budgetedLiveRevisionMessage,
  processBudgetedLiveRevisionBatch,
} from './minute-live-revision-budget-entry.js';
import { processBudgetedLiveTriggerBatch } from './minute-live-trigger-budget-entry.js';
import { processBudgetedLiveWriteBatch } from './minute-live-write-budget-entry.js';
import { consumeMinuteQueue } from './minute-production-entry.js';

export const LIVE_DERIVE_QUEUE_NAME = 'stationhead-minute-live-derive';
export const REBUILD_DERIVE_QUEUE_NAME = 'stationhead-minute-derive';
export const MINUTE_FACTS_QUEUE_NAME = 'stationhead-buddies-facts';
export const MINUTE_REBUILD_QUEUE_NAME = 'stationhead-minute-rebuild';

const EMPTY_DEPENDENCIES = Object.freeze({});
const REPAIR_RETIRED_ERROR = 'retired-repair-message-after-disable';
let deriveModulePromise = null;
let rebuildModulePromise = null;

async function processDeriveBatch(batch, env, dependencies) {
  const derive = await (deriveModulePromise ||= import('./minute-derive-entry.js'));
  return derive.processMinuteDeriveBatch(batch, env, dependencies);
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.trunc(parsed) > 0 ? Math.trunc(parsed) : null;
}

function enabled(value) {
  return value === true || value === 1 || /^(1|true|yes|on)$/i.test(String(value || ''));
}

function repairExplicitlyDisabled(env = {}) {
  const value = env?.MINUTE_FACT_REPAIR_BURST_ENABLED;
  return value != null && value !== '' && !enabled(value);
}

function liveRevisionMaterializationEnabled(env = {}) {
  const value = env?.LIVE_REVISION_MATERIALIZATION_ENABLED;
  if (value == null || value === '') return historicalRebuildEnabled(env);
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function triggerBatchKind(batch, jobKind) {
  const messages = batch?.messages || [];
  return messages.length > 0 && messages.every((message) => {
    const body = message?.body;
    return body?.message_type === 'minute-fact-derive'
      && Number(body?.message_version) === 1
      && String(body?.job_kind || 'live') === jobKind;
  });
}

function repairWorkMessage(body) {
  return String(body?.job_kind || '') === 'repair'
    || String(body?.job?.job_kind || '') === 'repair'
    || body?.payload?.rebuild?.repair === true
    || Boolean(body?.payload?.rebuild?.repair_key);
}

function repairWorkBatch(batch) {
  const messages = batch?.messages || [];
  return messages.length > 0 && messages.every((message) => repairWorkMessage(message?.body));
}

async function retireRepairJob(env, body, now) {
  const db = env?.MINUTE_DB;
  if (!db?.prepare) return false;
  const jobId = positiveInteger(body?.job?.id);
  let result;
  if (jobId != null) {
    result = await db.prepare(`UPDATE sh_minute_fact_jobs SET
        status='done',payload_json='{}',payload_clearable=0,lease_until=NULL,
        processed_at=COALESCE(processed_at,?),last_error=?,updated_at=?
      WHERE id=? AND job_kind='repair' AND status IN ('pending','processing','dead')`)
      .bind(now, REPAIR_RETIRED_ERROR, now, jobId)
      .run();
  } else {
    const channelId = positiveInteger(body?.channel_id);
    const minuteAt = Number(body?.minute_at);
    if (channelId == null || !Number.isFinite(minuteAt)) return false;
    result = await db.prepare(`UPDATE sh_minute_fact_jobs SET
        status='done',payload_json='{}',payload_clearable=0,lease_until=NULL,
        processed_at=COALESCE(processed_at,?),last_error=?,updated_at=?
      WHERE channel_id=? AND minute_at=? AND job_kind='repair'
        AND status IN ('pending','processing','dead')`)
      .bind(now, REPAIR_RETIRED_ERROR, now, channelId, Math.trunc(minuteAt))
      .run();
  }

  const repairKey = String(body?.payload?.rebuild?.repair_key || '').trim();
  if (repairKey) {
    await db.prepare(`UPDATE sh_minute_fact_repairs SET
        status='retired',last_error=COALESCE(last_error,?),updated_at=?
      WHERE repair_key=? AND status IN ('detected','queued')`)
      .bind(REPAIR_RETIRED_ERROR, now, repairKey)
      .run();
  }
  return Number(result?.meta?.changes || 0) > 0;
}

async function acknowledgeDisabledRepairWork(batch, env) {
  const now = Date.now();
  let retired = 0;
  for (const message of batch?.messages || []) {
    if (await retireRepairJob(env, message?.body, now)) retired += 1;
    message.ack();
  }
  const result = {
    event: 'minute_repair_derive_skipped',
    skipped: true,
    reason: 'repair-burst-disabled',
    messages: batch?.messages?.length || 0,
    retired,
  };
  console.log(JSON.stringify(result));
  return result;
}

function budgetedLiveTriggerBatch(batch, env) {
  return !liveRevisionMaterializationEnabled(env) && triggerBatchKind(batch, 'live');
}

function rebuildTriggerBatch(batch) {
  return triggerBatchKind(batch, 'rebuild');
}

function repairTriggerBatch(batch) {
  return triggerBatchKind(batch, 'repair');
}

function budgetedLiveRevisionBatch(batch, env) {
  if (liveRevisionMaterializationEnabled(env)) return false;
  const messages = batch?.messages || [];
  return messages.length > 0
    && messages.every((message) => budgetedLiveRevisionMessage(message?.body));
}

function budgetedLiveWriteBatch(batch, env) {
  if (liveRevisionMaterializationEnabled(env)) return false;
  const messages = batch?.messages || [];
  return messages.length > 0 && messages.every((message) => {
    const body = message?.body;
    const jobKind = String(body?.job?.job_kind || 'live');
    return body?.message_type === 'minute-fact-derive-stage'
      && Number(body?.message_version) === 1
      && (body?.stage === 'write' || body?.stage === 'budget-live-write')
      && positiveInteger(body?.job?.id) != null
      && jobKind !== 'rebuild'
      && jobKind !== 'repair'
      && body?.payload?.rebuild !== true
      && body?.payload?.rebuild?.repair !== true;
  });
}

function budgetedLiveCompleteBatch(batch, env) {
  if (liveRevisionMaterializationEnabled(env)) return false;
  const messages = batch?.messages || [];
  return messages.length > 0
    && messages.every((message) => budgetedLiveCompleteMessage(message?.body));
}

function rebuildEnvironment(env) {
  if (env?.BUDDIES_DB || !env?.DB) return env;
  const active = Object.create(env);
  Object.defineProperty(active, 'BUDDIES_DB', {
    value: env.DB,
    enumerable: false,
    configurable: true,
  });
  return active;
}

async function processRebuildBatch(batch, env, ctx, dependencies) {
  const rebuild = await (rebuildModulePromise ||= import('./minute-rebuild-batched-entry.js'));
  return rebuild.processMinuteRebuildBatch(batch, rebuildEnvironment(env), ctx, dependencies);
}

function acknowledgeDisabledHistoricalDerive(batch) {
  for (const message of batch?.messages || []) message.ack();
  console.log(JSON.stringify({
    event: 'minute_historical_derive_skipped',
    messages: batch?.messages?.length || 0,
    reason: 'historical-rebuild-disabled-for-d1-budget',
  }));
}

export async function processMinutePipelineBatch(batch, env, ctx, dependencies = EMPTY_DEPENDENCIES) {
  const queueName = String(batch?.queue || '');
  if (queueName === MINUTE_FACTS_QUEUE_NAME) {
    const consume = dependencies.consumeMinuteQueue || consumeMinuteQueue;
    return consume(batch, env, ctx);
  }
  if ((queueName === REBUILD_DERIVE_QUEUE_NAME || queueName === LIVE_DERIVE_QUEUE_NAME)
      && repairExplicitlyDisabled(env)
      && repairWorkBatch(batch)) {
    return acknowledgeDisabledRepairWork(batch, env);
  }
  if (queueName === REBUILD_DERIVE_QUEUE_NAME
      && !historicalRebuildEnabled(env)
      && !repairTriggerBatch(batch)) {
    return acknowledgeDisabledHistoricalDerive(batch);
  }
  if (queueName === LIVE_DERIVE_QUEUE_NAME && repairTriggerBatch(batch)) {
    const repairBatch = { ...batch, queue: REBUILD_DERIVE_QUEUE_NAME };
    const run = dependencies.processMinuteDeriveBatch;
    if (run) return run(repairBatch, env, dependencies.derive);
    return processDeriveBatch(repairBatch, env, dependencies.derive);
  }
  if (queueName === LIVE_DERIVE_QUEUE_NAME && rebuildTriggerBatch(batch)) {
    if (!historicalRebuildEnabled(env)) return acknowledgeDisabledHistoricalDerive(batch);
    const rebuildBatch = { ...batch, queue: REBUILD_DERIVE_QUEUE_NAME };
    const run = dependencies.processMinuteDeriveBatch;
    if (run) return run(rebuildBatch, env, dependencies.derive);
    return processDeriveBatch(rebuildBatch, env, dependencies.derive);
  }
  if (queueName === LIVE_DERIVE_QUEUE_NAME && budgetedLiveTriggerBatch(batch, env)) {
    const run = dependencies.processBudgetedLiveTriggerBatch || processBudgetedLiveTriggerBatch;
    return run(batch, env, dependencies.liveTrigger);
  }
  if (queueName === LIVE_DERIVE_QUEUE_NAME && budgetedLiveRevisionBatch(batch, env)) {
    const run = dependencies.processBudgetedLiveRevisionBatch || processBudgetedLiveRevisionBatch;
    return run(batch, env, dependencies.liveRevision);
  }
  if (queueName === LIVE_DERIVE_QUEUE_NAME && budgetedLiveWriteBatch(batch, env)) {
    const run = dependencies.processBudgetedLiveWriteBatch || processBudgetedLiveWriteBatch;
    return run(batch, env, dependencies.liveWrite);
  }
  if (queueName === LIVE_DERIVE_QUEUE_NAME && budgetedLiveCompleteBatch(batch, env)) {
    const run = dependencies.processBudgetedLiveCompleteBatch || processBudgetedLiveCompleteBatch;
    return run(batch, env, dependencies.liveComplete);
  }
  if (queueName === REBUILD_DERIVE_QUEUE_NAME || queueName === LIVE_DERIVE_QUEUE_NAME) {
    const run = dependencies.processMinuteDeriveBatch;
    if (run) return run(batch, env, dependencies.derive);
    return processDeriveBatch(batch, env, dependencies.derive);
  }
  if (queueName === MINUTE_REBUILD_QUEUE_NAME) {
    return processRebuildBatch(batch, env, ctx, dependencies.rebuild);
  }
  throw new Error(`Unsupported minute pipeline queue: ${queueName || 'missing'}`);
}

export {
  acknowledgeDisabledHistoricalDerive,
  acknowledgeDisabledRepairWork,
  budgetedLiveCompleteBatch,
  budgetedLiveTriggerBatch,
  budgetedLiveRevisionBatch,
  budgetedLiveWriteBatch,
  rebuildTriggerBatch,
  repairTriggerBatch,
  repairWorkBatch,
};

export default {
  queue: processMinutePipelineBatch,
};
