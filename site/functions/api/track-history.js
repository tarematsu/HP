import { fetchPagesReadModel } from '../lib/pages-read-model-service.js';

const TRACK_HISTORY_MODEL_KEY = 'track-history';

function unavailable() {
  return new Response(JSON.stringify({
    ok: false,
    error: 'track-history materialized response unavailable',
  }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function onRequestGet({ request, env }) {
  const publicUrl = new URL(request.url);
  const response = await fetchPagesReadModel(env, TRACK_HISTORY_MODEL_KEY, {
    api: true,
    params: publicUrl.searchParams,
  });
  if (!response) return unavailable();

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  if (response.ok) {
    headers.set('cache-control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600');
  } else if (response.status >= 500) {
    headers.set('cache-control', 'no-store');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
