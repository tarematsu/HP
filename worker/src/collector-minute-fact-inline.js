import { minuteFactQueueMessage } from './minute-facts-queue.js';

let consumeMinuteQueuePromise = null;

function runtimeInlineEnv(env) {
  const active = Object.create(env || null);
  Object.defineProperties(active, {
    LIVE_DERIVE_INLINE_ENABLED: { value: true, enumerable: false },
    LIVE_REVISION_MATERIALIZATION_ENABLED: { value: false, enumerable: false },
    MINUTE_ENRICHMENT_INLINE_PIPELINE_ENABLED: { value: true, enumerable: false },
  });
  return active;
}

async function defaultConsumeMinuteQueue(batch, env) {
  const module = await (consumeMinuteQueuePromise ||= import('./minute-production-entry.js'));
  return module.consumeMinuteQueue(batch, env);
}

export async function processInlineMinuteFactJob(env, input = {}, options = {}, dependencies = {}) {
  if (!env?.MINUTE_DB?.prepare) throw new Error('collector inline MINUTE_DB binding is missing');
  const body = minuteFactQueueMessage(input, options);
  let acked = false;
  let retried = false;
  let retryOptions = null;
  const message = {
    id: body.job_id,
    body,
    attempts: 1,
    ack() { acked = true; },
    retry(value = {}) {
      retried = true;
      retryOptions = value;
    },
  };
  const consume = dependencies.consumeMinuteQueue || defaultConsumeMinuteQueue;
  const summary = await consume({
    queue: 'stationhead-buddies-facts',
    messages: [message],
  }, runtimeInlineEnv(env));
  if (retried || Number(summary?.retried || 0) > 0) {
    const error = new Error(`collector inline minute fact requested retry${retryOptions?.delaySeconds ? ` after ${retryOptions.delaySeconds}s` : ''}`);
    error.code = 'COLLECTOR_INLINE_MINUTE_FACT_RETRY';
    throw error;
  }
  if (!acked) {
    const error = new Error('collector inline minute fact completed without acknowledgement');
    error.code = 'COLLECTOR_INLINE_MINUTE_FACT_UNACKED';
    throw error;
  }
  return {
    enqueued: Number(summary?.enqueued || 0) > 0,
    duplicate: Number(summary?.duplicates || 0) > 0,
    channel_id: body.channel_id,
    minute_at: body.minute_at,
    job_kind: body.options.jobKind,
    job_priority: body.options.jobPriority,
  };
}

export function resetCollectorMinuteFactInlineForTests() {
  consumeMinuteQueuePromise = null;
}
