const INTERNAL_URL = 'https://pages-read-model.internal/_internal/pages-response?key=amazon-music';

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

function jsonResponse(payload, status, cacheControl) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
      vary: 'accept-encoding',
    },
  });
}

function unavailable(message = 'Amazon Music read model unavailable') {
  return jsonResponse({ ok: false, error: message }, 503, 'no-store');
}

function coldStart() {
  return jsonResponse(EMPTY_READ_MODEL, 200, 'no-store');
}

export async function onRequestGet({ env }) {
  const service = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof service?.fetch !== 'function') return unavailable('PAGES_READ_MODEL_SERVICE binding missing');

  try {
    const response = await service.fetch(new Request(INTERNAL_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }));
    if (response?.status === 404) return coldStart();
    if (!response?.ok) return unavailable(`Amazon Music read model returned HTTP ${response?.status || 503}`);

    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('cache-control', 'public, max-age=15, s-maxage=30, stale-while-revalidate=60');
    headers.set('x-content-type-options', 'nosniff');
    headers.set('vary', 'accept-encoding');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error('amazon music read model failed', error);
    return unavailable();
  }
}
