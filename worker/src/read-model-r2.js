import { pagesR2ResponseKey } from './pages-response-r2.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function stringMetadata(value) {
  if (value == null) return undefined;
  const text = String(value);
  return text ? text : undefined;
}

export function readModelR2Key(modelKey) {
  return pagesR2ResponseKey(modelKey);
}

export async function headReadModelR2(bucket, modelKey) {
  const key = readModelR2Key(modelKey);
  if (!key || typeof bucket?.head !== 'function') return null;
  return bucket.head(key);
}

export async function publishReadModelR2(
  bucket,
  modelKey,
  body,
  {
    status = 200,
    headers = {},
    updatedAt = Date.now(),
    cadenceSeconds = 0,
    sourceRevision = null,
    rendererRevision = null,
    metadata = {},
  } = {},
) {
  const key = readModelR2Key(modelKey);
  if (!key || typeof bucket?.put !== 'function') throw new Error(`R2 read-model binding unavailable: ${modelKey}`);
  const persistedHeaders = objectOrEmpty(headers);
  const customMetadata = {
    version: '1',
    status: String(Number(status) || 200),
    headers_json: JSON.stringify(persistedHeaders),
    updated_at: String(Number(updatedAt) || Date.now()),
    cadence_seconds: String(Math.max(0, Number(cadenceSeconds) || 0)),
  };
  const source = stringMetadata(sourceRevision);
  const renderer = stringMetadata(rendererRevision);
  if (source) customMetadata.source_revision = source;
  if (renderer) customMetadata.renderer_revision = renderer;
  for (const [name, value] of Object.entries(objectOrEmpty(metadata))) {
    const normalized = stringMetadata(value);
    if (normalized !== undefined) customMetadata[name] = normalized;
  }
  await bucket.put(key, body, {
    httpMetadata: { contentType: persistedHeaders['content-type'] || JSON_CONTENT_TYPE },
    customMetadata,
  });
  return { storage: 'r2', object_key: key, bytes: String(body).length };
}

function freshEnough(updatedAt, now, maximumAgeMs) {
  const age = Number(maximumAgeMs);
  return Number.isFinite(updatedAt)
    && updatedAt >= 0
    && !(Number.isFinite(age) && age >= 0 && now - updatedAt > age);
}

export async function loadReadModelR2(
  bucket,
  modelKey,
  now = Date.now(),
  maximumAgeMs = Number.MAX_SAFE_INTEGER,
) {
  const key = readModelR2Key(modelKey);
  if (!key || typeof bucket?.get !== 'function') return null;
  const object = await bucket.get(key);
  if (!object?.body) return null;
  const metadata = objectOrEmpty(object.customMetadata);
  if (Number(metadata.version) !== 1) return null;
  const updatedAt = Number(metadata.updated_at);
  if (!freshEnough(updatedAt, now, maximumAgeMs)) return null;
  let persistedHeaders = {};
  try { persistedHeaders = JSON.parse(metadata.headers_json || '{}'); } catch {}
  const headers = new Headers(objectOrEmpty(persistedHeaders));
  if (typeof object.writeHttpMetadata === 'function') object.writeHttpMetadata(headers);
  headers.set('x-api-source', 'worker-r2');
  headers.set('x-materialized-at', String(updatedAt));
  const cadence = Number(metadata.cadence_seconds);
  if (Number.isFinite(cadence) && cadence > 0) headers.set('x-materialized-cadence-seconds', String(Math.trunc(cadence)));
  return new Response(object.body, {
    status: Number(metadata.status) || 200,
    headers,
  });
}
