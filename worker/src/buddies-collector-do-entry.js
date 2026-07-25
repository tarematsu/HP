import {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled as runDirectScheduled,
} from './buddies-collector-core.js';
import { recordCollectorOperationalTelemetry } from './collector-operational-telemetry.js';

const COORDINATOR_NAME = 'scheduled-v1';
const COORDINATOR_URL = 'https://buddies-collector-coordinator.internal/schedule';
const PENDING_SCHEDULE_KEY = 'collector:pending-schedule';
const MINUTE_STATE_KEY = 'collector:minute-state';
const MINUTE_MS = 60_000;

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

async function scheduleAlarm(stub, scheduledAt) {
  const response = await stub.fetch(COORDINATOR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'schedule', scheduledTime: scheduledAt }),
  });
  if (!response?.ok) {
    const detail = typeof response?.text === 'function' ? await response.text() : '';
    throw new Error(`collector coordinator HTTP ${response?.status || 500}: ${detail.slice(0, 300)}`);
  }
  return response.json();
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

async function clearPendingSchedule(storage, minuteAt) {
  if (typeof storage?.get !== 'function') return;
  const pending = await storage.get(PENDING_SCHEDULE_KEY);
  const pendingMinute = minuteBucket(pending?.scheduled_at ?? pending?.minute_at);
  if (Number.isFinite(pendingMinute) && pendingMinute === minuteAt) {
    await clearStorageKey(storage, PENDING_SCHEDULE_KEY);
  }
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
    try {
      return await scheduleAlarm(stub, scheduledAt);
    } catch (error) {
      diagnostic('buddies_collector_coordinator_failed', error);
      throw error;
    }
  }
  if (namespace) {
    throw new Error('buddies collector coordinator binding is unusable');
  }
  return runDirectScheduled(controller, env, ctx, dependencies.direct);
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

  async schedule(body = {}) {
    const storage = this.state?.storage;
    if (typeof storage?.setAlarm !== 'function'
        || typeof storage?.put !== 'function') {
      throw new Error('Durable Object alarm storage is unavailable');
    }
    const scheduledAt = Number(body?.scheduledTime) || this.now();
    const scheduledMinute = minuteBucket(scheduledAt);
    const alarmAt = Math.max(this.now(), scheduledAt);
    const existing = typeof storage.getAlarm === 'function' ? await storage.getAlarm() : null;
    if (existing != null && Number.isFinite(Number(existing)) && Number(existing) <= alarmAt) {
      return {
        scheduled: false,
        reason: 'collector-alarm-pending',
        scheduled_at: scheduledAt,
        minute_at: scheduledMinute,
        alarm_at: Number(existing),
      };
    }
    await storage.put(PENDING_SCHEDULE_KEY, {
      scheduled_at: scheduledAt,
      minute_at: scheduledMinute,
      stored_at: this.now(),
    });
    try {
      await storage.setAlarm(alarmAt);
    } catch (error) {
      await clearPendingSchedule(storage, scheduledMinute).catch(() => {});
      throw error;
    }
    return {
      scheduled: true,
      scheduled_at: scheduledAt,
      minute_at: scheduledMinute,
      alarm_at: alarmAt,
    };
  }

  async alarm() {
    const startedAt = this.now();
    const storage = this.state?.storage;
    if (typeof storage?.get !== 'function' || typeof storage?.put !== 'function') {
      throw new Error('Durable Object state storage is unavailable');
    }
    const pending = await storage.get(PENDING_SCHEDULE_KEY);
    const scheduledAt = Number(pending?.scheduled_at);
    const scheduledMinute = minuteBucket(
      Number.isFinite(scheduledAt) ? scheduledAt : (pending?.minute_at ?? startedAt),
    );
    const minuteState = await storage.get(MINUTE_STATE_KEY);
    if (Number(minuteState?.minute_at) === scheduledMinute) {
      if (minuteState?.status === 'completed') {
        await clearPendingSchedule(storage, scheduledMinute).catch(() => {});
        return {
          skipped: true,
          reason: 'collector-minute-already-completed',
          minute_at: scheduledMinute,
        };
      }
      if (minuteState?.status === 'running') {
        await clearPendingSchedule(storage, scheduledMinute).catch(() => {});
        return {
          skipped: true,
          reason: 'collector-minute-in-flight-or-uncertain',
          minute_at: scheduledMinute,
        };
      }
    }

    await storage.put(MINUTE_STATE_KEY, {
      minute_at: scheduledMinute,
      status: 'running',
      started_at: startedAt,
      scheduled_at: Number.isFinite(scheduledAt) ? scheduledAt : scheduledMinute,
    });

    let collectionCompleted = false;
    try {
      const result = await runDirectScheduled({
        cron: BUDDIES_COLLECTOR_CRON,
        scheduledTime: Number.isFinite(scheduledAt) ? scheduledAt : scheduledMinute,
      }, this.env, {}, this.dependencies.direct);
      collectionCompleted = true;
      const finishedAt = this.now();
      await storage.put(MINUTE_STATE_KEY, {
        minute_at: scheduledMinute,
        status: 'completed',
        started_at: startedAt,
        completed_at: finishedAt,
        scheduled_at: Number.isFinite(scheduledAt) ? scheduledAt : scheduledMinute,
      });
      await clearPendingSchedule(storage, scheduledMinute);
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
    if (body?.action !== 'schedule') {
      return Response.json({ error: 'invalid-action' }, { status: 400 });
    }
    return Response.json(await this.schedule(body));
  }
}

export const BUDDIES_COLLECTOR_COORDINATOR_STATE = Object.freeze({
  pending_schedule_key: PENDING_SCHEDULE_KEY,
  minute_state_key: MINUTE_STATE_KEY,
});

export default {
  scheduled: runAlarmCoordinatedBuddiesCollectorScheduled,
};
