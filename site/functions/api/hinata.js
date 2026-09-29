const HINATA_MODEL_KEY = 'hinata';

function unavailable() {
  return new Response(JSON.stringify({
    ok: false,
    error: 'hinata materialized response unavailable',
  }), {
    status: 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function onRequestGet({ env }) {
  const service = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof service?.fetch !== 'function') return unavailable();

  const url = new URL('https://pages-read-model.internal/_internal/pages-response');
  url.searchParams.set('key', HINATA_MODEL_KEY);
  let response;
  try {
    response = await service.fetch(new Request(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }));
  } catch {
    return unavailable();
  }
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
