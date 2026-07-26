import {
  BUDDIES_COLLECTOR_COORDINATOR_STATE,
  BuddiesCollectorCoordinator as BaseBuddiesCollectorCoordinator,
} from './buddies-collector-do-entry.js';

const LAST_SUCCESS_KEY = 'collector:last-success';
const MINUTE_MS = 60_000;
const MAX_WAIT_MS = 20_000;
const MAX_POLL_MS = 5_000;

function nonNegativeInteger(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, maximum);
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function minuteBucket(value) {
  const parsed = Number(value);
  const timestamp = Number.isFinite(parsed) ? parsed : Date.now();
  return Math.floor(timestamp / MINUTE_MS) * MINUTE_MS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BuddiesCollectorCoordinator extends BaseBuddiesCollectorCoordinator {
  async runMinute(body = {}) {
    const result = await super.runMinute(body);
    if (result?.skipped !== true) {
      const storage = this.state?.storage;
      const minuteState = typeof storage?.get === 'function'
        ? await storage.get(BUDDIES_COLLECTOR_COORDINATOR_STATE.minute_state_key)
        : null;
      if (minuteState?.status === 'completed' && typeof storage?.put === 'function') {
        await storage.put(LAST_SUCCESS_KEY, {
          minute_at: Number(minuteState.minute_at),
          completed_at: Number(minuteState.completed_at || this.now()),
          scheduled_at: Number(minuteState.scheduled_at || body?.scheduledTime || this.now()),
        });
      }
    }
    return result;
  }

  async status(body = {}) {
    const storage = this.state?.storage;
    if (typeof storage?.get !== 'function') {
      throw new Error('Durable Object state storage is unavailable');
    }
    const scheduledAt = Number(body?.scheduledTime) || this.now();
    const targetMinute = minuteBucket(scheduledAt);
    const minimumSuccessAt = nonNegativeInteger(body?.minimumSuccessAt, targetMinute);
    const waitMs = nonNegativeInteger(body?.waitMs, 0, MAX_WAIT_MS);
    const pollMs = positiveInteger(body?.pollMs, 1_000, MAX_POLL_MS);
    const deadline = this.now() + waitMs;
    const wait = this.dependencies?.sleep || sleep;

    while (true) {
      const [minuteState, lastSuccess] = await Promise.all([
        storage.get(BUDDIES_COLLECTOR_COORDINATOR_STATE.minute_state_key),
        storage.get(LAST_SUCCESS_KEY),
      ]);
      const completedMinute = minuteState?.status === 'completed'
        ? Number(minuteState.minute_at || 0)
        : 0;
      const lastSuccessAt = Math.max(
        completedMinute,
        Number(lastSuccess?.minute_at || 0),
      );
      if (lastSuccessAt >= minimumSuccessAt) {
        return {
          ready: true,
          target_minute: targetMinute,
          minimum_success_at: minimumSuccessAt,
          last_success_at: lastSuccessAt,
          minute_at: minuteState?.minute_at == null ? null : Number(minuteState.minute_at),
          status: minuteState?.status || null,
        };
      }
      const now = this.now();
      if (now >= deadline) {
        return {
          ready: false,
          reason: 'collector-not-ready',
          target_minute: targetMinute,
          minimum_success_at: minimumSuccessAt,
          last_success_at: lastSuccessAt,
          minute_at: minuteState?.minute_at == null ? null : Number(minuteState.minute_at),
          status: minuteState?.status || null,
        };
      }
      await wait(Math.min(pollMs, Math.max(1, deadline - now)));
    }
  }

  async fetch(request) {
    if (request?.method === 'POST') {
      try {
        const body = await request.clone().json();
        if (body?.action === 'status') return Response.json(await this.status(body));
      } catch {
        // Preserve the parent coordinator invalid JSON contract.
      }
    }
    return super.fetch(request);
  }
}

export const BUDDIES_COLLECTOR_STATUS_STATE = Object.freeze({
  last_success_key: LAST_SUCCESS_KEY,
  max_wait_ms: MAX_WAIT_MS,
  max_poll_ms: MAX_POLL_MS,
});
