import { proxyPagesReadModel } from '../lib/pages-read-model-service.js';

const EMPTY_READ_MODEL = Object.freeze({
  ok: true,
  version: 3,
  source: null,
  artist_id: null,
  artist_name: '坂道3グループ',
  artists: ['乃木坂46', '櫻坂46', '日向坂46'],
  snapshot_date: null,
  observed_at: null,
  follower: null,
  track_count: 0,
  tracks: [],
  history: [],
  scan: null,
});

export function onRequestGet({ env }) {
  return proxyPagesReadModel(env, 'amazon-music', {
    cacheControl: 'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
    unavailableMessage: 'Amazon Music read model unavailable',
    httpErrorPrefix: 'Amazon Music read model',
    coldStartPayload: EMPTY_READ_MODEL,
  });
}
