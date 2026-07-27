import {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled as runDirectScheduled,
} from './buddies-collector-core.js';
import { withCollectorDoHotState } from './collector-do-hot-state.js';
import { recordCollectorOperationalTelemetry } from './collector-operational-telemetry.js';
import { queueAttributedEnv } from './queue-attribution.js';

const COORDINATOR_NAME = 'scheduled-v1';
const COORDINATOR_URL = 'https://buddies-collector-coordinator.internal/run';
const PENDING_SCHEDULE_KEY = 'collector:pending-schedule';
const MINUTE_STATE_KEY = 'collector:minute-state';
const MINUTE_MS = 60_000;

function enabled(value) {
  return value === true || value === 1 || /^(1|true|yes|on)$/i.test(String(value || ''));
}

function coordinatorStub(namespace) {
  if (typeof namespace?.getByName === 'function') return namespace.getByName(COORDINATOR_NAME);
  if (typeof namespace?.idFromName === 'function' && typeof namespace?.get === 'function') {
    return namespace.get(namespace.idFromName(COORDINATOR_NAME));
  }
  return null;
}

function diagnostic(event, error, detail = {}) {
  console.error(JSON.stringify({
    event,
    ...detail,
    error: String(error?.message || error).slice(0, 500),
  }));
}

function minuteBucket(timestamp) {
  return Math.floor(Number(timestamp) / MINUTE_MS) * MINUTE_MS;
}

async function clearStorageKey(storage, key) {
  if (typeof storage?.delete === 'function') {
    await storage.delete(key);
  } else if (typeof storage?.put === 'function') {
    await storage.put(key, null);
  }
}

async function coordinatorRequest(stub, action, scheduledAt) {
  const response = await stub.fetch(COORDINATOR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, scheduledTime: scheduledAt }),
  });
  if (!response?.ok) {
    const detail = typeof response?.text === 'function' ? await response.text() : '';
    throw new Error(`collector coordinator HTTP ${response?.status || 500}: ${detail.slice(0, 300)}`);
  }
  return response.json();
}

function telemetrySample(result) {
  if (!result || typeof result !== 'object') return {};
  return {
    payload_bytes: result.payload_bytes,
    queue_total_tracks: result.queue_total_tracks,
    queue_materialized_tracks: result.queue_materialized_tracks,
    queue_items_written: result.queue_items_written,
    like_observations_written: result.like_observations_written,
    d1_rows_written_estimate: result.d1_rows_written_estimate,
    queue_send_attempts: result.queue_send_attempts,
    queue_send_ms: result.queue_send_ms,
    outbox_rows_written: result.outbox_rows_written,
    outbox_rows_deleted: result.outbox_rows_deleted,
    outbox_rows_quarantined: result.outbox_rows_quarantined,
    outbox_backoff_ms: result.outbox_backoff_ms,
    pending_flushed: result.pending_flushed,
    prepared_fallback: result.prepared_fallback,
    materialization_state_written: result.materialization_state_written === true ? 1 : 0,
  };
}

function primaryRunDeferred(result) {
  return result?.skipped === true && result?.reason === 'collector-run-already-active';
}

export async function runAlarmCoordinatedBuddiesCollectorScheduled(
  controller,
  env,
  ctx,
  dependencies = {},
) {
  const cron = String(controller?.cron || '');
  if (cron !== BUDDIES_COLLECTOR_CRON) {
    return { skipped: true, reason: 'unsupported-buddies-collector-cron', cron };
  }
  const scheduledAt = Number(controller?.scheduledTime) || Date.now();
  const namespace = env?.BUDDIES_COLLECTOR_COORDINATOR;
  const stub = dependencies.stub || coordinatorStub(namespace);
  if (typeof stub?.fetch === 'function') {
    const action = enabled(env?.COLLECTOR_COORDINATOR_USE_ALARM) ? 'schedule' : 'run';
    try {
      return await coordinatorRequest(stub, action, scheduledAt);
    } catch (error) {
      diagnostic('buddies_collector_coordinator_failed', error, { action });
      throw error;
    }
  }
  if (namespace) throw new Error('buddies collector coordinator binding is unusable');
  return runDirectScheduled(
    controller,
    queueAttributedEnv(env, 'sh-buddies-collector'),
    ctx,
    dependencies.direct,
  );
}

export class BuddiesCollectorCoordinator {
  constructor(state, env, dependencies = {}) {
    this.state = state;
    this.env = env;
    this.dependencies = dependencies;
  }

  now() {
    const value = this.dependencies.now?.();
    return Number.isFinite(Number(value)) ? Number(value) : Date.now();
  }

  activeEnv() {
    const attributed = queueAttributedEnv(this.env, 'sh-buddies-collector');
    return withCollectorDoHotState(attributed, this.state?.storage);
  }

  async runMinute(body = {}) {
    const storage = this.state?.storage;
    if (typeof storage?.get !== 'function' || typeof storage?.put !== 'function') {
      throw new Error('Durable Object state storage is unavailable');
    }
    const scheduledAt = Number(body?.scheduledTime) || this.now();
    const scheduledMinute = minuteBucket(scheduledAt);
    const minuteState = await storage.get(MINUTE_STATE_KEY);
    if (Number(minuteState?.minute_at) === scheduledMinute) {
      if (minuteState?.status === 'completed') {
        return {
          skipped: true,
          reason: 'collector-minute-already-completed',
          minute_at: scheduledMinute,
        };
      }
      if (minuteState?.status === 'running') {
        return {
          skipped: true,
          reason: 'collector-minute-in-flight-or-uncertain',
          minute_at: scheduledMinute,
        };
      }
    }

    const startedAt = this.now();
    await storage.put(MINUTE_STATE_KEY, {
      minute_at: scheduledMinute,
      status: 'running',
      started_at: startedAt,
      scheduled_at: scheduledAt,
    });

    let collectionCompleted = false;
    try {
      const result = await runDirectScheduled({
        cron: BUDDIES_COLLECTOR_CRON,
        scheduledTime: scheduledAt,
      }, this.activeEnv(), {}, this.dependencies.direct);
      const finishedAt = this.now();
      if (primaryRunDeferred(result)) {
        await storage.put(MINUTE_STATE_KEY, {
          minute_at: scheduledMinute,
          status: 'deferred',
          reason: result.reason,
          started_at: startedAt,
          deferred_at: finishedAt,
          scheduled_at: scheduledAt,
        });
        console.warn(JSON.stringify({
          event: 'collector_minute_deferred',
          reason: result.reason,
          minute_at: scheduledMinute,
          scheduled_at: scheduledAt,
        }));
        await recordCollectorOperationalTelemetry(this.state, this.env, {
          ok: true,
          skipped: true,
          timestamp: finishedAt,
          duration_ms: finishedAt - startedAt,
          primary_lock_deferred: 1,
        }).catch((error) => diagnostic('collector_telemetry_failed', error));
        return {
          ...result,
          minute_at: scheduledMinute,
          retryable: true,
        };
      }

      collectionCompleted = true;
      await storage.put(MINUTE_STATE_KEY, {
        minute_at: scheduledMinute,
        status: 'completed',
        started_at: startedAt,
        completed_at: finishedAt,
        scheduled_at: scheduledAt,
      });
      await recordCollectorOperationalTelemetry(this.state, this.env, {
        ok: true,
        timestamp: finishedAt,
        duration_ms: finishedAt - startedAt,
        ...telemetrySample(result),
      }).catch((error) => diagnostic('collector_telemetry_failed', error));
      return result;
    } catch (error) {
      const finishedAt = this.now();
      if (!collectionCompleted) {
        await clearStorageKey(storage, MINUTE_STATE_KEY).catch((clearError) => {
          diagnostic('collector_minute_state_reset_failed', clearError, { minute_at: scheduledMinute });
        });
      } else {
        diagnostic('collector_completion_checkpoint_failed', error, { minute_at: scheduledMinute });
      }
      await recordCollectorOperationalTelemetry(this.state, this.env, {
        ok: false,
        timestamp: finishedAt,
        duration_ms: finishedAt - startedAt,
        checkpoint_uncertain: collectionCompleted ? 1 : 0,
      }).catch(() => {});
      throw error;
    }
  }

  async schedule(body = {}) {
    const storage = this.state?.storage;
    if (typeof storage?.setAlarm !== 'function' || typeof storage?.put !== 'function') {
      throw new Error('Durable Object alarm storage is unavailable');
    }
    const scheduledAt = Number(body?.scheduledTime) || this.now();
    const alarmAt = Math.max(this.now(), scheduledAt);
    const existing = typeof storage.getAlarm === 'function' ? await storage.getAlarm() : null;
    if (existing != null && Number.isFinite(Number(existing)) && Number(existing) <= alarmAt) {
      return {
        scheduled: false,
        reason: 'collector-alarm-pending',
        scheduled_at: scheduledAt,
        minute_at: minuteBucket(scheduledAt),
        alarm_at: Number(existing),
      };
    }
    await storage.put(PENDING_SCHEDULE_KEY, {
      scheduled_at: scheduledAt,
      minute_at: minuteBucket(scheduledAt),
      stored_at: this.now(),
    });
    await storage.setAlarm(alarmAt);
    return {
      scheduled: true,
      scheduled_at: scheduledAt,
      minute_at: minuteBucket(scheduledAt),
      alarm_at: alarmAt,
    };
  }

  async alarm() {
    const storage = this.state?.storage;
    const pending = typeof storage?.get === 'function'
      ? await storage.get(PENDING_SCHEDULE_KEY)
      : null;
    const result = await this.runMinute({
      scheduledTime: Number(pending?.scheduled_at) || this.now(),
    });
    await clearStorageKey(storage, PENDING_SCHEDULE_KEY).catch(() => {});
    return result;
  }

  async fetch(request) {
    if (request?.method !== 'POST') {
      return Response.json({ error: 'method-not-allowed' }, { status: 405 });
    }
    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid-json' }, { status: 400 });
    }
    if (body?.action === 'run') return Response.json(await this.runMinute(body));
    if (body?.action === 'schedule') return Response.json(await this.schedule(body));
    return Response.json({ error: 'invalid-action' }, { status: 400 });
  }
}

export const BUDDIES_COLLECTOR_COORDINATOR_STATE = Object.freeze({
  pending_schedule_key: PENDING_SCHEDULE_KEY,
  minute_state_key: MINUTE_STATE_KEY,
  default_mode: 'direct-request',
});

export default {
  scheduled: runAlarmCoordinatedBuddiesCollectorScheduled,
};