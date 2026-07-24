const STATE_KEY = 'collector:operational-telemetry';
const DEFAULT_INTERVAL_MS = 5 * 60_000;
const MAX_PENDING_WINDOWS = 12;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.trunc(parsed) > 0 ? Math.trunc(parsed) : fallback;
}

function intervalMs(env) {
  return positiveInteger(env?.COLLECTOR_TELEMETRY_INTERVAL_MS, DEFAULT_INTERVAL_MS);
}

function bucketStart(timestamp, duration) {
  return Math.floor(timestamp / duration) * duration;
}

function emptyWindow(timestamp, duration) {
  const start = bucketStart(timestamp, duration);
  return {
    schema_version: 1,
    source: 'sh-buddies-collector',
    bucket_start: start,
    bucket_end: start + duration,
    collections: 0,
    failures: 0,
    duration_ms_sum: 0,
    duration_ms_max: 0,
    updated_at: timestamp,
  };
}

function addSample(window, sample) {
  const duration = Math.max(0, Number(sample.duration_ms) || 0);
  return {
    ...window,
    collections: Number(window.collections || 0) + (sample.ok ? 1 : 0),
    failures: Number(window.failures || 0) + (sample.ok ? 0 : 1),
    duration_ms_sum: Number(window.duration_ms_sum || 0) + duration,
    duration_ms_max: Math.max(Number(window.duration_ms_max || 0), duration),
    updated_at: sample.timestamp,
  };
}

function objectKey(window) {
  const iso = new Date(Number(window.bucket_start) || 0).toISOString();
  return `operational/collector/${iso.slice(0, 10).replaceAll('-', '/')}/${iso.slice(11, 16).replace(':', '-')}.json`;
}

async function deliver(env, window) {
  const bucket = env?.RUNTIME_ANALYTICS_R2 || env?.PAGES_RESPONSE_R2;
  if (typeof bucket?.put !== 'function') return false;
  await bucket.put(objectKey(window), JSON.stringify(window), {
    httpMetadata: { contentType: 'application/json' },
  });
  return true;
}

export async function recordCollectorOperationalTelemetry(state, env, sample) {
  const storage = state?.storage;
  if (typeof storage?.get !== 'function' || typeof storage?.put !== 'function') return false;

  const duration = intervalMs(env);
  const currentStart = bucketStart(sample.timestamp, duration);
  const stored = await storage.get(STATE_KEY);
  const telemetry = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored
    : { active: null, pending: [] };
  const pending = Array.isArray(telemetry.pending) ? [...telemetry.pending] : [];
  let active = telemetry.active;
  if (!active || Number(active.bucket_start) !== currentStart) {
    if (active) pending.push(active);
    active = emptyWindow(sample.timestamp, duration);
  }
  active = addSample(active, sample);
  while (pending.length > MAX_PENDING_WINDOWS) pending.shift();

  let deliveryError = null;
  if (pending.length) {
    try {
      if (await deliver(env, pending[0])) pending.shift();
    } catch (error) {
      deliveryError = error;
    }
  }
  await storage.put(STATE_KEY, { active, pending });
  if (deliveryError) throw deliveryError;
  return true;
}

export const COLLECTOR_OPERATIONAL_TELEMETRY = Object.freeze({
  state_key: STATE_KEY,
  default_interval_ms: DEFAULT_INTERVAL_MS,
  max_pending_windows: MAX_PENDING_WINDOWS,
});