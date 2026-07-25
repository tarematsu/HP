const DEFAULT_INTERVAL_MS = 5 * 60_000;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.trunc(parsed) > 0 ? Math.trunc(parsed) : fallback;
}

function bucketStart(timestamp, duration) {
  return Math.floor(timestamp / duration) * duration;
}

function safeQueueName(value) {
  return String(value || 'unknown').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 120) || 'unknown';
}

function objectKey(queue, timestamp, duration) {
  const start = bucketStart(timestamp, duration);
  const iso = new Date(start).toISOString();
  return `operational/recovery/${iso.slice(0, 10).replaceAll('-', '/')}/${iso.slice(11, 16).replace(':', '-')}/${safeQueueName(queue)}.json`;
}

async function storedWindow(bucket, key) {
  if (typeof bucket?.get !== 'function') return null;
  const stored = await bucket.get(key);
  if (!stored || typeof stored.text !== 'function') return null;
  try {
    const parsed = JSON.parse(await stored.text());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mergeTypes(current, next) {
  const merged = { ...(current || {}) };
  for (const [type, count] of Object.entries(next || {})) {
    merged[type] = Number(merged[type] || 0) + Number(count || 0);
  }
  return merged;
}

export async function recordRecoveryOperationalTelemetry(env, sample) {
  const bucket = env?.RUNTIME_ANALYTICS_R2 || env?.PAGES_RESPONSE_R2;
  if (typeof bucket?.put !== 'function') return false;
  const timestamp = Number(sample?.timestamp) || Date.now();
  const duration = positiveInteger(env?.RECOVERY_TELEMETRY_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  const key = objectKey(sample?.queue, timestamp, duration);
  const previous = await storedWindow(bucket, key);
  const start = bucketStart(timestamp, duration);
  const window = {
    schema_version: 1,
    source: 'sh-buddies-recovery',
    queue: String(sample?.queue || 'unknown'),
    bucket_start: start,
    bucket_end: start + duration,
    invocations: Number(previous?.invocations || 0) + 1,
    processed: Number(previous?.processed || 0) + Number(sample?.processed || 0),
    acknowledged: Number(previous?.acknowledged || 0) + Number(sample?.acknowledged || 0),
    retried: Number(previous?.retried || 0) + Number(sample?.retried || 0),
    failed: Number(previous?.failed || 0) + Number(sample?.failed || 0),
    duration_ms_sum: Number(previous?.duration_ms_sum || 0) + Math.max(0, Number(sample?.duration_ms || 0)),
    duration_ms_max: Math.max(
      Number(previous?.duration_ms_max || 0),
      Math.max(0, Number(sample?.duration_ms || 0)),
    ),
    oldest_message_age_ms_max: Math.max(
      Number(previous?.oldest_message_age_ms_max || 0),
      Math.max(0, Number(sample?.oldest_message_age_ms || 0)),
    ),
    message_types: mergeTypes(previous?.message_types, sample?.message_types),
    updated_at: timestamp,
  };
  await bucket.put(key, JSON.stringify(window), {
    httpMetadata: { contentType: 'application/json' },
  });
  return true;
}

export const RECOVERY_OPERATIONAL_TELEMETRY = Object.freeze({
  default_interval_ms: DEFAULT_INTERVAL_MS,
});
