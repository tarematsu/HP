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
  const service = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof service?.fetch !== 'function') return unavailable();

  const publicUrl = new URL(request.url);
  const url = new URL('https://pages-read-model.internal/_internal/pages-response');
  url.searchParams.set('key', TRACK_HISTORY_MODEL_KEY);
  url.searchParams.set('api', '1');
  for (const [name, value] of publicUrl.searchParams.entries()) {
    if (name === 'v' || name === 'key' || name === 'api') continue;
    url.searchParams.append(name, value);
  }

  let response;
  try {
    response = await service.fetch(new Request(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }));
  } catch {
    return unavailable();
  }
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
