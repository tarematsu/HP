const STATE_KEY = 'collector:operational-telemetry';
const DEFAULT_INTERVAL_MS = 5 * 60_000;
const MAX_PENDING_WINDOWS = 12;
const MAX_DELIVERIES_PER_SAMPLE = 3;
const NUMERIC_METRICS = Object.freeze([
  'payload_bytes',
  'queue_total_tracks',
  'queue_materialized_tracks',
  'queue_items_written',
  'like_observations_written',
  'd1_rows_written_estimate',
  'queue_send_attempts',
  'queue_send_ms',
  'outbox_rows_written',
  'outbox_rows_deleted',
  'outbox_rows_quarantined',
  'outbox_backoff_ms',
  'pending_flushed',
  'prepared_fallback',
  'checkpoint_uncertain',
  'primary_lock_deferred',
  'materialization_state_written',
]);

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
    schema_version: 4,
    source: 'sh-buddies-collector',
    bucket_start: start,
    bucket_end: start + duration,
    collections: 0,
    failures: 0,
    skipped: 0,
    duration_ms_sum: 0,
    duration_ms_max: 0,
    updated_at: timestamp,
  };
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function addMetrics(window, sample) {
  const next = { ...window };
  for (const key of NUMERIC_METRICS) {
    const value = numeric(sample?.[key]);
    if (value == null) continue;
    next[`${key}_sum`] = Number(next[`${key}_sum`] || 0) + value;
    next[`${key}_max`] = Math.max(Number(next[`${key}_max`] || 0), value);
    next[`${key}_last`] = value;
  }
  return next;
}

function addSample(window, sample) {
  const duration = Math.max(0, Number(sample.duration_ms) || 0);
  const skipped = sample?.skipped === true;
  return addMetrics({
    ...window,
    collections: Number(window.collections || 0) + (sample.ok && !skipped ? 1 : 0),
    failures: Number(window.failures || 0) + (!sample.ok && !skipped ? 1 : 0),
    skipped: Number(window.skipped || 0) + (skipped ? 1 : 0),
    duration_ms_sum: Number(window.duration_ms_sum || 0) + duration,
    duration_ms_max: Math.max(Number(window.duration_ms_max || 0), duration),
    updated_at: sample.timestamp,
  }, sample);
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
    : { active: null, pending: [], dropped_windows: 0, delivery_failures: 0 };
  const pending = Array.isArray(telemetry.pending) ? [...telemetry.pending] : [];
  let droppedWindows = Number(telemetry.dropped_windows || 0);
  let deliveryFailures = Number(telemetry.delivery_failures || 0);
  let active = telemetry.active;
  if (!active || Number(active.bucket_start) !== currentStart) {
    if (active) pending.push(active);
    active = emptyWindow(sample.timestamp, duration);
  }
  active = addSample(active, sample);
  while (pending.length > MAX_PENDING_WINDOWS) {
    pending.shift();
    droppedWindows += 1;
  }

  let deliveryError = null;
  for (let attempt = 0; attempt < MAX_DELIVERIES_PER_SAMPLE && pending.length; attempt += 1) {
    try {
      if (!await deliver(env, pending[0])) break;
      pending.shift();
    } catch (error) {
      deliveryFailures += 1;
      deliveryError = error;
      break;
    }
  }
  active = {
    ...active,
    dropped_windows_total: droppedWindows,
    delivery_failures_total: deliveryFailures,
  };
  await storage.put(STATE_KEY, {
    active,
    pending,
    dropped_windows: droppedWindows,
    delivery_failures: deliveryFailures,
  });
  if (deliveryError) throw deliveryError;
  return true;
}

export const COLLECTOR_OPERATIONAL_TELEMETRY = Object.freeze({
  state_key: STATE_KEY,
  default_interval_ms: DEFAULT_INTERVAL_MS,
  max_pending_windows: MAX_PENDING_WINDOWS,
  max_deliveries_per_sample: MAX_DELIVERIES_PER_SAMPLE,
  numeric_metrics: NUMERIC_METRICS,
});