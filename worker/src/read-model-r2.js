import { pagesR2ResponseKey } from './pages-response-r2.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
function objectOrEmpty(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function stringMetadata(value) { if (value == null) return undefined; const text = String(value); return text || undefined; }
function freshEnough(updatedAt, now, maximumAgeMs) {
  const age = Number(maximumAgeMs);
  return Number.isFinite(updatedAt) && updatedAt >= 0 && !(Number.isFinite(age) && age >= 0 && now - updatedAt > age);
}
export function readModelR2Key(modelKey) { return pagesR2ResponseKey(modelKey); }
export async function headReadModelR2(bucket, modelKey) {
  const key = readModelR2Key(modelKey); return key && typeof bucket?.head === 'function' ? bucket.head(key) : null;
}
export async function publishReadModelR2(bucket, modelKey, body, {
  status = 200, headers = {}, updatedAt = Date.now(), cadenceSeconds = 0,
  sourceRevision = null, rendererRevision = null, metadata = {},
} = {}) {
  const key = readModelR2Key(modelKey);
  if (!key || typeof bucket?.put !== 'function') throw new Error(`R2 read-model binding unavailable: ${modelKey}`);
  const persistedHeaders = objectOrEmpty(headers);
  const source = stringMetadata(sourceRevision); const renderer = stringMetadata(rendererRevision);
  const envelope = {
    version: 1,
    updated_at: Number(updatedAt) || Date.now(),
    cadence_seconds: Math.max(0, Number(cadenceSeconds) || 0),
    status: Number(status) || 200,
    headers: persistedHeaders,
    body: String(body),
    ...(source ? { source_revision: source } : {}),
    ...(renderer ? { renderer_revision: renderer } : {}),
  };
  const customMetadata = { version: '1', updated_at: String(envelope.updated_at) };
  if (source) customMetadata.source_revision = source;
  if (renderer) customMetadata.renderer_revision = renderer;
  for (const [name, value] of Object.entries(objectOrEmpty(metadata))) {
    const normalized = stringMetadata(value); if (normalized !== undefined) customMetadata[name] = normalized;
  }
  await bucket.put(key, JSON.stringify(envelope), {
    httpMetadata: { contentType: JSON_CONTENT_TYPE }, customMetadata,
  });
  return { storage: 'r2', object_key: key, bytes: envelope.body.length };
}
export async function loadReadModelR2(bucket, modelKey, now = Date.now(), maximumAgeMs = Number.MAX_SAFE_INTEGER) {
  const key = readModelR2Key(modelKey);
  if (!key || typeof bucket?.get !== 'function') return null;
  const object = await bucket.get(key); if (!object?.body) return null;
  let envelope;
  try { envelope = await object.json(); } catch { return null; }
  if (Number(envelope?.version) !== 1 || typeof envelope?.body !== 'string') return null;
  const updatedAt = Number(envelope.updated_at); if (!freshEnough(updatedAt, now, maximumAgeMs)) return null;
  const headers = new Headers(objectOrEmpty(envelope.headers));
  headers.set('x-api-source', 'worker-r2'); headers.set('x-materialized-at', String(updatedAt));
  const cadence = Number(envelope.cadence_seconds); if (Number.isFinite(cadence) && cadence > 0) headers.set('x-materialized-cadence-seconds', String(Math.trunc(cadence)));
  return new Response(envelope.body, { status: Number(envelope.status) || 200, headers });
}
