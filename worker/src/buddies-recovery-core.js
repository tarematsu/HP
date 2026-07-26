import './fetch-guard.js';

import ingestWorker from './ingest-channel-optimized-entry.js';
import { recordRecoveryOperationalTelemetry } from './recovery-operational-telemetry.js';
import { rawCollectorEnv } from './runtime-env.js';

const EMPTY_DEPENDENCIES = Object.freeze({});
const RETRY_BASE_SECONDS = 5;
const RETRY_MAX_SECONDS = 300;

export const BUDDIES_RECOVERY_QUEUE_NAMES = Object.freeze([
  'stationhead-raw-collection',
  'stationhead-ingest-finalize',
  'stationhead-comments',
  'stationhead-buddies-persist',
]);

const BUDDIES_RECOVERY_QUEUE_SET = new Set(BUDDIES_RECOVERY_QUEUE_NAMES);

export function recoveryRetryDelaySeconds(attempts) {
  const attempt = Math.max(1, Math.trunc(Number(attempts) || 1));
  return Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * (2 ** (attempt - 1)));
}

function bodyType(message) {
  const type = message?.body?.message_type;
  return String(type || 'unknown').slice(0, 120);
}

function messageTimestamp(message) {
  const value = message?.timestamp;
  if (value instanceof Date) return value.getTime();
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function messageAttempts(message) {
  const parsed = Math.trunc(Number(message?.attempts));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function instrumentMessage(message, counters) {
  let settled = false;
  return new Proxy(message, {
    get(target, property) {
      if (property === 'ack') {
        return (...args) => {
          if (!settled) {
            counters.acknowledged += 1;
            settled = true;
          }
          return target.ack(...args);
        };
      }
      if (property === 'retry') {
        return (...args) => {
          if (!settled) {
            counters.retried += 1;
            counters.failed += 1;
            settled = true;
          }
          return target.retry(...args);
        };
      }
      if (property === '__recoverySettled') return () => settled;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function singleMessageBatch(batch, message) {
  const scoped = Object.create(batch || null);
  Object.defineProperties(scoped, {
    queue: { value: batch?.queue, enumerable: true },
    messages: { value: [message], enumerable: true },
  });
  return scoped;
}

function messageAge(messages, now) {
  const timestamps = messages.map(messageTimestamp).filter(Number.isFinite);
  if (!timestamps.length) return 0;
  return Math.max(0, now - Math.min(...timestamps));
}

function retryMessage(message, attempts) {
  message.retry({ delaySeconds: recoveryRetryDelaySeconds(attempts) });
}

export async function runBuddiesRecoveryQueue(
  batch,
  env,
  ctx,
  dependencies = EMPTY_DEPENDENCIES,
) {
  const queueName = String(batch?.queue || '');
  if (!BUDDIES_RECOVERY_QUEUE_SET.has(queueName)) {
    throw new Error(`unsupported buddies recovery queue: ${queueName || 'unknown'}`);
  }
  const messages = Array.from(batch?.messages || []);
  if (!messages.length) {
    return {
      queue: queueName,
      processed: 0,
      acknowledged: 0,
      retried: 0,
      failed: 0,
      max_attempts: 0,
    };
  }

  const run = dependencies.runIngestQueue || ingestWorker.queue;
  const recordTelemetry = dependencies.recordTelemetry || recordRecoveryOperationalTelemetry;
  const now = dependencies.now || Date.now;
  const startedAt = Number(now());
  const counters = { acknowledged: 0, retried: 0, failed: 0 };
  const types = {};
  const activeEnv = rawCollectorEnv(env);
  let maxAttempts = 1;

  for (const sourceMessage of messages) {
    const type = bodyType(sourceMessage);
    const attempts = messageAttempts(sourceMessage);
    maxAttempts = Math.max(maxAttempts, attempts);
    types[type] = Number(types[type] || 0) + 1;
    const message = instrumentMessage(sourceMessage, counters);
    try {
      await run(
        singleMessageBatch(batch, message),
        activeEnv,
        ctx,
        dependencies.ingest || EMPTY_DEPENDENCIES,
      );
      if (!message.__recoverySettled()) retryMessage(message, attempts);
    } catch (error) {
      if (!message.__recoverySettled()) retryMessage(message, attempts);
      console.error(JSON.stringify({
        event: 'buddies_recovery_dispatch_failed',
        queue: queueName,
        message_type: type,
        attempts,
        retry_delay_seconds: recoveryRetryDelaySeconds(attempts),
        error: String(error?.message || error).slice(0, 800),
      }));
    }
  }

  const finishedAt = Number(now());
  const summary = {
    queue: queueName,
    processed: messages.length,
    acknowledged: counters.acknowledged,
    retried: counters.retried,
    failed: counters.failed,
    max_attempts: maxAttempts,
    duration_ms: Math.max(0, finishedAt - startedAt),
    oldest_message_age_ms: messageAge(messages, finishedAt),
    message_types: types,
  };
  await recordTelemetry(activeEnv, {
    ...summary,
    timestamp: finishedAt,
  }).catch((error) => {
    console.error(JSON.stringify({
      event: 'buddies_recovery_telemetry_failed',
      queue: queueName,
      error: String(error?.message || error).slice(0, 800),
    }));
  });
  return summary;
}

export default {
  queue: runBuddiesRecoveryQueue,
};
