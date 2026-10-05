import { headReadModelR2, publishReadModelR2 } from './read-model-r2.js';

export async function historyPublicationIsComplete(bucket, key, revision) {
  const object = await headReadModelR2(bucket, key);
  return object?.customMetadata?.source_revision === revision;
}

export function publishHistoryReadModel(bucket, key, payload, {
  now = Date.now(),
  sourceRevision,
  rendererRevision,
} = {}) {
  return publishReadModelR2(bucket, key, JSON.stringify(payload), {
    status: 200,
    updatedAt: now,
    cadenceSeconds: 0,
    sourceRevision,
    rendererRevision,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30, s-maxage=60',
    },
  });
}
