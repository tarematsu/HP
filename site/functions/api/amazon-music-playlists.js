import { proxyPagesReadModel } from '../lib/pages-read-model-service.js';

const EMPTY_READ_MODEL = Object.freeze({
  ok: true,
  version: 1,
  source: 'amazon-music-track-related-playlists',
  observed_at: null,
  coverage: {
    total_tracks: 0,
    checked_tracks: 0,
    pending_tracks: 0,
    error_tracks: 0,
  },
  tracks: [],
});

export function onRequestGet({ env }) {
  return proxyPagesReadModel(env, 'amazon-music-playlists', {
    cacheControl: 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
    unavailableMessage: 'Amazon Music playlist read model unavailable',
    httpErrorPrefix: 'Amazon Music playlist read model',
    coldStartPayload: EMPTY_READ_MODEL,
  });
}
