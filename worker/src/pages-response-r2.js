const R2_RESPONSE_KEY_PREFIX = 'pages-response/v1/';
const RAW_FORMAT = 'raw-response-v1';

function normalizedModelKey(value) {
  const key = String(value || '').trim();
  return key && key.length <= 256 ? key : null;
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function freshEnough(updatedAt, now, maximumAgeMs) {
  const age = Number(maximumAgeMs);
  return Number.isFinite(updatedAt)
    && updatedAt >= 0
    && !(Number.isFinite(age) && age >= 0 && now - updatedAt > age);
}

export function pagesR2ResponseKey(modelKey) {
  const key = normalizedModelKey(modelKey);
  return key ? `${R2_RESPONSE_KEY_PREFIX}${encodeURIComponent(key)}.json` : null;
}

// Deprecated source-compatibility aliases. They resolve only to the canonical
// pages-response/v1 namespace; the legacy actions-v2 namespace is read only in
// pages-response-store.js.
export function pagesActionsR2ResponseKey(modelKey) {
  return pagesR2ResponseKey(modelKey);
}

export async function saveMaterializedR2Response(
  r2,
  modelKey,
  body,
  status,
  headers,
  now,
  cadenceSeconds,
  metadata = {},
) {
  const key = pagesR2ResponseKey(modelKey);
  if (!key || typeof r2?.put !== 'function') return null;
  const updatedAt = Number(now) || Date.now();
  const customMetadata = {
    version: '1',
    format: RAW_FORMAT,
    status: String(Number(status) || 200),
    headers_json: JSON.stringify(headers || {}),
    updated_at: String(updatedAt),
    cadence_seconds: String(Math.max(0, Number(cadenceSeconds) || 0)),
  };
  for (const [name, value] of Object.entries(objectOrNull(metadata) || {})) {
    if (value != null && String(value)) customMetadata[name] = String(value);
  }
  await r2.put(key, body, {
    httpMetadata: { contentType: headers?.['content-type'] || 'application/json; charset=utf-8' },
    customMetadata,
  });
  return {
    bytes: typeof body?.length === 'number' ? body.length : 0,
    chunks: 1,
    storage: 'r2',
    object_key: key,
  };
}

export function saveMaterializedActionsR2Response(
  r2,
  modelKey,
  body,
  status,
  headers,
  now,
  cadenceSeconds,
  metadata,
) {
  return saveMaterializedR2Response(
    r2,
    modelKey,
    body,
    status,
    headers,
    now,
    cadenceSeconds,
    metadata,
  );
}

function responseFromEnvelope(envelope, now, maximumAgeMs, source) {
  if (Number(envelope?.version) !== 1 || typeof envelope?.body !== 'string') return null;
  const updatedAt = Number(envelope.updated_at);
  if (!freshEnough(updatedAt, now, maximumAgeMs)) return null;
  const headers = new Headers(objectOrNull(envelope.headers) || {});
  headers.set('x-api-source', source);
  headers.set('x-materialized-at', String(updatedAt));
  const cadence = Number(envelope.cadence_seconds);
  if (Number.isFinite(cadence) && cadence > 0) {
    headers.set('x-materialized-cadence-seconds', String(Math.trunc(cadence)));
  }
  return new Response(envelope.body, {
    status: Number(envelope.status) || 200,
    headers,
  });
}

function directMetadata(metadata) {
  if (!metadata) return false;
  return metadata.format === RAW_FORMAT
    || metadata.headers_json != null
    || metadata.status != null
    || metadata.cadence_seconds != null;
}

async function loadCanonicalResponse(r2, modelKey, now, maximumAgeMs) {
  const key = pagesR2ResponseKey(modelKey);
  if (!key || typeof r2?.get !== 'function') return null;
  const object = await r2.get(key);
  if (!object?.body) return null;
  const metadata = objectOrNull(object.customMetadata) || {};
  if (!directMetadata(metadata)) {
    // Transitional reader for canonical envelopes created before raw-v1 rollout.
    try {
      return responseFromEnvelope(
        await object.json(),
        now,
        maximumAgeMs,
        'worker-r2-migration',
      );
    } catch {
      return null;
    }
  }
  const updatedAt = Number(metadata.updated_at);
  if (!freshEnough(updatedAt, now, maximumAgeMs)) return null;
  let persistedHeaders = {};
  try {
    persistedHeaders = JSON.parse(metadata.headers_json || '{}');
  } catch {}
  const headers = new Headers(objectOrNull(persistedHeaders) || {});
  if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
  headers.set('x-api-source', 'worker-r2');
  headers.set('x-materialized-at', String(updatedAt));
  const cadence = Number(metadata.cadence_seconds);
  if (Number.isFinite(cadence) && cadence > 0) {
    headers.set('x-materialized-cadence-seconds', String(Math.trunc(cadence)));
  }
  return new Response(object.body, {
    status: Number(metadata.status) || 200,
    headers,
  });
}

export function loadMaterializedR2Response(
  r2,
  modelKey,
  now = Date.now(),
  maximumAgeMs = Number.MAX_SAFE_INTEGER,
) {
  return loadCanonicalResponse(r2, modelKey, now, maximumAgeMs);
}
