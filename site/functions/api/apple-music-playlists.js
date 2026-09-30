const INTERNAL_URL = 'https://pages-read-model.internal/_internal/pages-response?key=apple-music-playlists';

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

function unavailable(message = 'Apple Music playlist read model unavailable') {
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
    if (!response?.ok) return unavailable(`Apple Music playlist read model returned HTTP ${response?.status || 503}`);

    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400');
    headers.set('x-content-type-options', 'nosniff');
    headers.set('vary', 'accept-encoding');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error('apple music playlist read model failed', error);
    return unavailable();
  }
}