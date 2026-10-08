import { requireStationheadSourceProfile } from '../../packages/sh-shared/stationhead-source.mjs';
import { waitForCollectorCoordinator } from './collector-coordinator-status.js';

const OHISAMA = requireStationheadSourceProfile('ohisama');
const FIVE_MINUTES_MS = 5 * 60_000;
const ONE_MINUTE_MS = 60_000;
const WAIT_MS = 12_000;

function slot(scheduledAt) {
  const at = Number(scheduledAt);
  if (!Number.isFinite(at) || at < 0) throw new Error('invalid Ohisama schedule timestamp');
  const fiveMinuteStart = Math.floor(at / FIVE_MINUTES_MS) * FIVE_MINUTES_MS;
  const offset = Math.floor((at - fiveMinuteStart) / ONE_MINUTE_MS);
  return { fiveMinuteStart, offset };
}

async function retryMarker(r2) {
  if (typeof r2?.get !== 'function') return null;
  const object = await r2.get(OHISAMA.priorityRetryKey);
  return object ? await object.json() : null;
}

async function deferRetry(r2, fiveMinuteStart, scheduledAt) {
  if (typeof r2?.put !== 'function') return false;
  await r2.put(OHISAMA.priorityRetryKey, JSON.stringify({
    version: 1, slot_at: fiveMinuteStart, deferred_at: scheduledAt,
  }), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return true;
}

export async function clearOhisamaPriorityRetry(env, scheduledAt) {
  const { fiveMinuteStart, offset } = slot(scheduledAt);
  if (offset !== 2 || typeof env?.PAGES_RESPONSE_R2?.delete !== 'function') return false;
  const marker = await retryMarker(env.PAGES_RESPONSE_R2);
  if (Number(marker?.slot_at) !== fiveMinuteStart) return false;
  await env.PAGES_RESPONSE_R2.delete(OHISAMA.priorityRetryKey);
  return true;
}

// Buddies owns its five-minute Durable Object lease. Ohisama must never
// take that lease: it only waits for the Buddies collection checkpoint.
export async function coordinateOhisamaCollection(env, scheduledAt, options = {}) {
  const { fiveMinuteStart, offset } = slot(scheduledAt);
  if (offset !== 1 && offset !== 2) return { skipped: false, reason: 'manual-or-unaligned' };
  if (offset === 2) {
    const marker = await retryMarker(env?.PAGES_RESPONSE_R2);
    if (Number(marker?.slot_at) !== fiveMinuteStart || Number(marker?.version) !== 1) {
      return { skipped: true, reason: 'no-buddies-priority-retry' };
    }
  }
  if (!env?.BUDDIES_COLLECTOR_COORDINATOR) {
    return { skipped: false, reason: 'buddies-coordinator-unavailable' };
  }
  const waitMs = Math.max(0, Math.min(20_000, Number(options.waitMs ?? env.STATIONHEAD_SECONDARY_PRIORITY_WAIT_MS ?? WAIT_MS) || 0));
  const status = await waitForCollectorCoordinator(env, scheduledAt, {
    minimumSuccessAt: fiveMinuteStart,
    waitMs, pollMs: 1_000, stub: options.stub,
  });
  if (!status) return { skipped: false, reason: 'buddies-status-unavailable' };
  if (status.ready) return { skipped: false, reason: 'buddies-complete' };
  // A failed, deferred or stale Buddies run is not active contention. Let
  // Ohisama continue rather than starving it whenever Buddies is unhealthy.
  if (status.status !== 'running' || Number(status.minuteAt) < fiveMinuteStart) {
    return { skipped: false, reason: 'buddies-not-in-flight' };
  }
  if (offset === 1) await deferRetry(env?.PAGES_RESPONSE_R2, fiveMinuteStart, scheduledAt);
  return {
    skipped: true,
    reason: offset === 1 ? 'waiting-for-buddies-priority' : 'buddies-priority-retry-exhausted',
    buddies_status: status.status,
  };
}
