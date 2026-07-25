import {
  MINUTE_FACT_REPAIR_KEY,
  runMinuteFactsRepair,
} from './minute-facts-repair.js';

export const MINUTE_FACT_REPAIR_BURST_MESSAGE = 'minute-fact-repair-burst';
export const MINUTE_FACT_REPAIR_BURST_COMPLETE_KEY = `operational/minute-fact-repair/${MINUTE_FACT_REPAIR_KEY}/complete-v1`;
export const MAX_BURST_CANDIDATES = 20;
export const MAX_BURST_ENQUEUES = 2;
export const MAX_BURST_DISPATCH = 2;
const MINUTE_DERIVE_MESSAGE_TYPE = 'minute-fact-derive';
const MINUTE_DERIVE_MESSAGE_VERSION = 1;

function enabled(value) {
  if (value == null || value === '') return false;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function positiveInteger(value, fallback, maximum) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function minuteFactRepairBurstEnabled(env = {}) {
  return enabled(env.MINUTE_FACT_REPAIR_BURST_ENABLED);
}

export async function minuteFactRepairBurstComplete(env = {}) {
  if (!env?.PAGES_RESPONSE_KV?.get) return false;
  try {
    return await env.PAGES_RESPONSE_KV.get(MINUTE_FACT_REPAIR_BURST_COMPLETE_KEY) === '1';
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'minute_fact_repair_burst_completion_read_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return false;
  }
}

async function markBurstComplete(env, result) {
  if (!result?.complete || !env?.PAGES_RESPONSE_KV?.put) return false;
  try {
    await env.PAGES_RESPONSE_KV.put(MINUTE_FACT_REPAIR_BURST_COMPLETE_KEY, '1');
    return true;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'minute_fact_repair_burst_completion_write_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return false;
  }
}

function repairDatabaseEnv(env) {
  return {
    DB: env?.BUDDIES_DB,
    MINUTE_DB: env?.MINUTE_DB,
    MINUTE_FACT_REPAIR_CANDIDATE_LIMIT: positiveInteger(
      env?.MINUTE_FACT_REPAIR_CANDIDATE_LIMIT,
      MAX_BURST_CANDIDATES,
      MAX_BURST_CANDIDATES,
    ),
    MINUTE_FACT_REPAIR_ENQUEUE_LIMIT: positiveInteger(
      env?.MINUTE_FACT_REPAIR_ENQUEUE_LIMIT,
      MAX_BURST_ENQUEUES,
      MAX_BURST_ENQUEUES,
    ),
  };
}

function dispatchOrder(left, right) {
  const priority = Number(right?.job_priority || 0) - Number(left?.job_priority || 0);
  if (priority) return priority;
  const minute = Number(left?.minute_at || 0) - Number(right?.minute_at || 0);
  if (minute) return minute;
  return Number(left?.id || 0) - Number(right?.id || 0);
}

function repairTrigger(row) {
  const channelId = Math.trunc(Number(row.channel_id));
  const minuteAt = Math.trunc(Number(row.minute_at));
  return {
    message_type: MINUTE_DERIVE_MESSAGE_TYPE,
    message_version: MINUTE_DERIVE_MESSAGE_VERSION,
    job_id: `minute-fact:${channelId}:${minuteAt}`,
    channel_id: channelId,
    minute_at: minuteAt,
    job_kind: 'repair',
  };
}

async function pendingRepairTriggers(env, now, limit) {
  const [pending, expired] = await Promise.all([
    env.MINUTE_DB.prepare(`SELECT id,channel_id,minute_at,job_kind,job_priority
      FROM sh_minute_fact_jobs INDEXED BY idx_sh_minute_fact_jobs_pending_ready
      WHERE status='pending' AND next_attempt_at<=? AND job_kind='repair'
      ORDER BY next_attempt_at ASC,job_priority DESC,minute_at ASC,id ASC
      LIMIT ?`).bind(now, limit).all(),
    env.MINUTE_DB.prepare(`SELECT id,channel_id,minute_at,job_kind,job_priority
      FROM sh_minute_fact_jobs INDEXED BY idx_sh_minute_fact_jobs_processing_lease
      WHERE status='processing' AND lease_until<? AND job_kind='repair'
      ORDER BY lease_until ASC,id ASC
      LIMIT ?`).bind(now, limit).all(),
  ]);
  return [...(pending.results || []), ...(expired.results || [])]
    .sort(dispatchOrder)
    .slice(0, limit)
    .map(repairTrigger);
}

async function sendRepairMessages(queue, messages) {
  if (!messages.length) return;
  if (!queue?.send && typeof queue?.sendBatch !== 'function') {
    throw new Error('MINUTE_DERIVE_QUEUE binding is missing');
  }
  if (typeof queue.sendBatch === 'function') {
    for (let offset = 0; offset < messages.length; offset += 100) {
      await queue.sendBatch(messages.slice(offset, offset + 100).map((body) => ({
        body,
        contentType: 'json',
      })));
    }
    return;
  }
  await Promise.all(messages.map((body) => queue.send(body, { contentType: 'json' })));
}

export async function runMinuteFactRepairBurst(env, options = {}) {
  if (!minuteFactRepairBurstEnabled(env)) {
    return { skipped: true, reason: 'repair-burst-disabled' };
  }
  if (!env?.BUDDIES_DB || !env?.MINUTE_DB) {
    throw new Error('minute fact repair burst database bindings are missing');
  }

  // The Runtime Coordinator suppresses future burst messages after completion.
  // Avoid a KV read here so each active minute performs only the repair work.
  const now = Number(options.now) || Date.now();
  const repair = await runMinuteFactsRepair(repairDatabaseEnv(env), now);
  const dispatchLimit = positiveInteger(
    env.MINUTE_FACT_REPAIR_DISPATCH_LIMIT,
    MAX_BURST_DISPATCH,
    MAX_BURST_DISPATCH,
  );
  const triggers = await pendingRepairTriggers(env, now, dispatchLimit);
  await sendRepairMessages(env.MINUTE_DERIVE_QUEUE, triggers);
  const completionRecorded = await markBurstComplete(env, repair);
  const summary = {
    event: 'minute_fact_repair_burst',
    repair,
    dispatched: triggers.length,
    rebuild_messages: triggers.length,
    dispatch_limit: dispatchLimit,
    completion_recorded: completionRecorded,
  };
  console.log(JSON.stringify(summary));
  return summary;
}
