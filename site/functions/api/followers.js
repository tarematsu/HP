import { fetchPagesReadModel } from '../lib/pages-read-model-service.js';

const FOLLOWERS_MODEL_KEY = 'followers';

function unavailable() {
  return new Response(JSON.stringify({
    ok: false,
    error: 'followers materialized response unavailable',
  }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function onRequestGet({ env }) {
  const response = await fetchPagesReadModel(env, FOLLOWERS_MODEL_KEY);
  if (!response?.ok) return unavailable();

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'public, max-age=30, s-maxage=300, stale-while-revalidate=600');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
