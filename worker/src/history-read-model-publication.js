import { ACTIONS_RAW_MODEL_KEYS, pagesActionsR2ResponseKey, pagesActionsRawR2ResponseKey, pagesActionsRawMetadataR2ResponseKey } from './pages-response-r2.js';

export async function historyPublicationIsComplete(bucket, key, revision) {
  const source = await bucket.head(pagesActionsR2ResponseKey(key));
  if (source?.customMetadata?.historySourceRevision !== revision) return false;
  if (!ACTIONS_RAW_MODEL_KEYS.includes(key)) return true;
  const [raw, metadata] = await Promise.all([
    bucket.head(pagesActionsRawR2ResponseKey(key)), bucket.head(pagesActionsRawMetadataR2ResponseKey(key)),
  ]);
  return Boolean(source.etag && raw?.customMetadata?.source_etag === source.etag
    && metadata?.customMetadata?.source_etag === source.etag);
}

export async function seedHistoryRawResponse(bucket, key, envelope, etag) {
  if (!ACTIONS_RAW_MODEL_KEYS.includes(key)) return;
  if (!etag) throw new Error('history publication ETag is missing');
  await bucket.put(pagesActionsRawR2ResponseKey(key), envelope.body, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }, customMetadata: { source_etag: etag },
  });
  await bucket.put(pagesActionsRawMetadataR2ResponseKey(key), JSON.stringify({
    version: 1, source_etag: etag, status: envelope.status,
    headers: envelope.headers, updated_at: envelope.updated_at, cadence_seconds: 0,
  }), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }, customMetadata: { source_etag: etag },
  });
}

export async function publishHistoryEnvelope(bucket, key, envelope, revision) {
  const object = await bucket.put(pagesActionsR2ResponseKey(key), JSON.stringify(envelope), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }, customMetadata: { historySourceRevision: revision },
  });
  await seedHistoryRawResponse(bucket, key, envelope, object?.etag);
}
