import {
  loadMaterializedR2Response,
  pagesR2ResponseKey,
  saveMaterializedR2Response,
} from './pages-response-r2.js';

function objectOrEmpty(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function stringMetadata(value) { if (value == null) return undefined; const text = String(value); return text || undefined; }

export function readModelR2Key(modelKey) { return pagesR2ResponseKey(modelKey); }
export async function headReadModelR2(bucket, modelKey) {
  const key = readModelR2Key(modelKey); return key && typeof bucket?.head === 'function' ? bucket.head(key) : null;
}
export async function publishReadModelR2(bucket, modelKey, body, {
  status = 200, headers = {}, updatedAt = Date.now(), cadenceSeconds = 0,
  sourceRevision = null, rendererRevision = null, metadata = {},
} = {}) {
  const source = stringMetadata(sourceRevision);
  const renderer = stringMetadata(rendererRevision);
  return saveMaterializedR2Response(
    bucket,
    modelKey,
    String(body),
    status,
    objectOrEmpty(headers),
    updatedAt,
    cadenceSeconds,
    {
      ...(source ? { source_revision: source } : {}),
      ...(renderer ? { renderer_revision: renderer } : {}),
      ...objectOrEmpty(metadata),
    },
  );
}
export function loadReadModelR2(bucket, modelKey, now = Date.now(), maximumAgeMs = Number.MAX_SAFE_INTEGER) {
  return loadMaterializedR2Response(bucket, modelKey, now, maximumAgeMs);
}
