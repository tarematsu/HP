const COORDINATOR_NAME = 'scheduled-v1';
const COORDINATOR_URL = 'https://buddies-collector-coordinator.internal/status';
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

function coordinatorStub(namespace) {
  if (typeof namespace?.getByName === 'function') return namespace.getByName(COORDINATOR_NAME);
  if (typeof namespace?.idFromName === 'function' && typeof namespace?.get === 'function') {
    return namespace.get(namespace.idFromName(COORDINATOR_NAME));
  }
  return null;
}

export function collectorMinuteAt(value = Date.now()) {
  const parsed = Number(value);
  const timestamp = Number.isFinite(parsed) ? parsed : Date.now();
  return Math.floor(timestamp / MINUTE_MS) * MINUTE_MS;
}

export async function waitForCollectorCoordinator(env = {}, scheduledAt = Date.now(), options = {}) {
  const stub = options.stub || coordinatorStub(env?.BUDDIES_COLLECTOR_COORDINATOR);
  if (typeof stub?.fetch !== 'function') return null;

  const targetMinute = collectorMinuteAt(scheduledAt);
  const requiredSuccessAt = nonNegativeInteger(options.minimumSuccessAt, targetMinute);
  const waitMs = nonNegativeInteger(
    options.waitMs ?? env?.COLLECTOR_PRIORITY_WAIT_MS,
    0,
    MAX_WAIT_MS,
  );
  const pollMs = positiveInteger(
    options.pollMs ?? env?.COLLECTOR_PRIORITY_POLL_MS,
    1_000,
    MAX_POLL_MS,
  );

  try {
    const response = await stub.fetch(COORDINATOR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'status',
        scheduledTime: Number(scheduledAt) || Date.now(),
        minimumSuccessAt: requiredSuccessAt,
        waitMs,
        pollMs,
      }),
    });
    if (!response?.ok) {
      const detail = typeof response?.text === 'function' ? await response.text() : '';
      throw new Error(`collector coordinator status HTTP ${response?.status || 500}: ${detail.slice(0, 300)}`);
    }
    const status = await response.json();
    return {
      ready: status?.ready === true,
      reason: status?.ready === true ? undefined : status?.reason || 'collector-not-ready',
      targetMinute,
      requiredSuccessAt,
      lastSuccessAt: Number(status?.last_success_at || 0),
      minuteAt: status?.minute_at == null ? null : Number(status.minute_at),
      status: status?.status || null,
      source: 'durable-object',
    };
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'collector_coordinator_status_failed',
      target_minute: targetMinute,
      error: String(error?.message || error).slice(0, 500),
    }));
    return null;
  }
}

export const COLLECTOR_COORDINATOR_STATUS = Object.freeze({
  coordinator_name: COORDINATOR_NAME,
  max_wait_ms: MAX_WAIT_MS,
  max_poll_ms: MAX_POLL_MS,
});
