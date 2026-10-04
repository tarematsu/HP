const CACHE_CONTROL = 'public, max-age=30, s-maxage=300, stale-while-revalidate=600';

function unavailable(service) {
  return new Response(JSON.stringify({
    ok: false,
    error: 'music service materialized response unavailable',
    service,
  }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function fetchMaterialized(service, key) {
  const url = new URL('https://pages-read-model.internal/_internal/pages-response');
  url.searchParams.set('key', key);
  try {
    return await service.fetch(new Request(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }));
  } catch {
    return null;
  }
}

export async function musicServiceReadModelResponse(env, serviceId) {
  const service = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof service?.fetch !== 'function') return unavailable(serviceId);

  // New materializations use music-service:<service>. Keep the old storage key
  // as a read-only migration fallback until existing R2 objects age out.
  let response = await fetchMaterialized(service, `music-service:${serviceId}`);
  if (!response?.ok) response = await fetchMaterialized(service, `regional-music:${serviceId}`);
  if (!response?.ok) return unavailable(serviceId);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}