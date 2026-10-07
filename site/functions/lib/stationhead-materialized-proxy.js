import { stationheadReadModelKey } from '../../../packages/sh-shared/stationhead-read-models.mjs';
import { fetchPagesReadModel } from './pages-read-model-service.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function unavailable(error, status = 503) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: {
      'content-type': JSON_CONTENT_TYPE,
      'cache-control': 'no-store',
    },
  });
}

export async function proxyStationheadMaterializedReadModel(
  env,
  source,
  {
    unavailableError = 'stationhead materialized response unavailable',
    cacheControl = 'public, max-age=0, s-maxage=60, stale-while-revalidate=120',
    mapFailureStatus = (status) => status === 404 ? 503 : status || 503,
  } = {},
) {
  const modelKey = stationheadReadModelKey(source);
  if (!modelKey) return unavailable(unavailableError);
  const response = await fetchPagesReadModel(env, modelKey);

  if (!response?.ok) return unavailable(unavailableError, mapFailureStatus(response?.status));

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', JSON_CONTENT_TYPE);
  headers.set('cache-control', cacheControl);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
