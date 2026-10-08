import { proxyPagesReadModel } from '../lib/pages-read-model-service.js';

const EMPTY_READ_MODEL = Object.freeze({
  ok: true,
  version: 1,
  source: null,
  artist_id: null,
  artist_name: '櫻坂46',
  observed_at: null,
  scan_date: null,
  coverage: {
    seed_pages: 0,
    seed_pages_succeeded: 0,
    known_playlists: 0,
    scanned_this_run: 0,
    matched_playlists: 0,
  },
  playlists: [],
  tracks: [],
});

export function onRequestGet({ env }) {
  return proxyPagesReadModel(env, 'apple-music-playlists', {
    cacheControl: 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
    unavailableMessage: 'Apple Music playlist read model unavailable',
    httpErrorPrefix: 'Apple Music playlist read model',
    coldStartPayload: EMPTY_READ_MODEL,
  });
}
