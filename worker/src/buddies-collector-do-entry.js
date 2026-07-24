import coreWorker, {
  BUDDIES_COLLECTOR_CRON,
  runBuddiesCollectorScheduled as runDirectScheduled,
} from './buddies-collector-core.js';
import { recordCollectorOperationalTelemetry } from './collector-operational-telemetry.js';

const COORDINATOR_NAME = 'scheduled-v1';
const COORDINATOR_URL = 'https://buddies-collector-coordinator.internal/schedule';

function coordinatorStub(namespace) {
  if (typeof namespace?.getByName === 'function') return namespace.getByName(COORDINATOR_NAME);
  if (typeof namespace?.idFromName === 'function' && typeof namespace?.get === 'function') {
    return namespace.get(namespace.idFromName(COORDINATOR_NAME));
  }
  return null;
}

function diagnostic(event, error) {
  console.error(JSON.stringify({
    event,
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
  const stub = dependencies.stub || coordinatorStub(env?.BUDDIES_COLLECTOR_COORDINATOR);
  if (typeof stub?.fetch === 'function') {
    try {
      return await scheduleAlarm(stub, scheduledAt);
    } catch (error) {
      diagnostic('buddies_collector_coordinator_failed', error);
    }
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
    if (typeof storage?.setAlarm !== 'function') {
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
        alarm_at: Number(existing),
      };
    }
    await storage.setAlarm(alarmAt);
    return { scheduled: true, scheduled_at: scheduledAt, alarm_at: alarmAt };
  }

  async alarm() {
    const startedAt = this.now();
    try {
      const result = await runDirectScheduled({
        cron: BUDDIES_COLLECTOR_CRON,
        scheduledTime: startedAt,
      }, this.env, {}, this.dependencies.direct);
      const finishedAt = this.now();
      await recordCollectorOperationalTelemetry(this.state, this.env, {
        ok: true,
        timestamp: finishedAt,
        duration_ms: finishedAt - startedAt,
      }).catch((error) => diagnostic('collector_telemetry_failed', error));
      return result;
    } catch (error) {
      const finishedAt = this.now();
      await recordCollectorOperationalTelemetry(this.state, this.env, {
        ok: false,
        timestamp: finishedAt,
        duration_ms: finishedAt - startedAt,
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

export default {
  scheduled: runAlarmCoordinatedBuddiesCollectorScheduled,
  queue: coreWorker.queue,
};
