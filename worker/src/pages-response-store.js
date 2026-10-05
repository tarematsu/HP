import { loadMaterializedR2Response } from './pages-response-r2.js';

const LEGACY_ACTIONS_RESPONSE_KEY_PREFIX = 'pages-response/actions-v2/';

function normalizedModelKey(value) {
  const key = String(value || '').trim();
  return key && key.length <= 256 ? key : null;
}

function hexModelKey(value) {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function legacyActionsR2ResponseKey(modelKey) {
  const key = normalizedModelKey(modelKey);
  return key ? `${LEGACY_ACTIONS_RESPONSE_KEY_PREFIX}${hexModelKey(key)}.json` : null;
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

function responseFromLegacyEnvelope(envelope, now, maximumAgeMs) {
  if (Number(envelope?.version) !== 1 || typeof envelope?.body !== 'string') return null;
  const updatedAt = Number(envelope.updated_at);
  if (!freshEnough(updatedAt, now, maximumAgeMs)) return null;
  const headers = new Headers(objectOrNull(envelope.headers) || {});
  headers.set('x-api-source', 'legacy-actions-r2');
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

async function loadLegacyActionsR2Response(r2, modelKey, now, maximumAgeMs) {
  const key = legacyActionsR2ResponseKey(modelKey);
  if (!key || typeof r2?.get !== 'function') return null;
  const object = await r2.get(key);
  if (!object?.body) return null;
  try {
    return responseFromLegacyEnvelope(await object.json(), now, maximumAgeMs);
  } catch {
    return null;
  }
}

export async function loadMaterializedResponse(
  r2,
  modelKey,
  now = Date.now(),
  maximumAgeMs = Number.MAX_SAFE_INTEGER,
) {
  const canonical = await loadMaterializedR2Response(r2, modelKey, now, maximumAgeMs);
  if (canonical) return canonical;
  return loadLegacyActionsR2Response(r2, modelKey, now, maximumAgeMs);
}
