import { proxyPagesReadModel } from '../lib/pages-read-model-service.js';

const EMPTY_READ_MODEL = Object.freeze({
  ok: true,
  version: 1,
  source: null,
  artist_id: null,
  artist_name: '櫻坂46',
  snapshot_date: null,
  observed_at: null,
  regions: [],
  history: [],
});

export function onRequestGet({ env }) {
  return proxyPagesReadModel(env, 'apple-music', {
    cacheControl: 'public, max-age=30, s-maxage=300, stale-while-revalidate=600',
    unavailableMessage: 'Apple Music read model unavailable',
    httpErrorPrefix: 'Apple Music read model',
    coldStartPayload: EMPTY_READ_MODEL,
  });
}
