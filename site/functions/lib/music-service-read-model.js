import { fetchPagesReadModel } from './pages-read-model-service.js';

const QUERY_ROUTES = Object.freeze({ kkbox: 'kkbox', qq_music: 'qq-music', kugou_music: 'kugou-music' });
const CACHE_CONTROL = 'public, max-age=30, s-maxage=300, stale-while-revalidate=600';

export async function musicServiceReadModelResponse(env, serviceId) {
  const route = QUERY_ROUTES[serviceId];
  let response = await fetchPagesReadModel(env, route ? `query:${route}` : `music-service:${serviceId}`);
  if (!route && !response?.ok) response = await fetchPagesReadModel(env, `regional-music:${serviceId}`);
  if (!response?.ok) return Response.json({ ok: false, error: 'music service materialized response unavailable', service: serviceId },
    { status: 503, headers: { 'cache-control': 'no-store' } });
  const headers = new Headers(response.headers);
  headers.set('cache-control', CACHE_CONTROL);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
