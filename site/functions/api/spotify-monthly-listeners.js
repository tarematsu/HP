import {
  spotifyMonthlyListenersSql,
  spotifyMonthlyListenersTrend,
} from '../../../packages/sh-shared/spotify-read-model.mjs';

export { spotifyMonthlyListenersSql, spotifyMonthlyListenersTrend };

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});
const SPOTIFY_READ_MODEL_URL = 'https://pages-read-model.internal/_internal/pages-response?key=spotify-playcounts';

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

async function materializedMonthlyListenerRows(env) {
  const service = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof service?.fetch !== 'function') {
    throw new Error('PAGES_READ_MODEL_SERVICE binding missing');
  }
  const response = await service.fetch(new Request(SPOTIFY_READ_MODEL_URL, {
    method: 'GET',
    headers: { accept: 'application/json' },
  }));
  if (!response?.ok) {
    throw new Error(`Spotify read model returned HTTP ${response?.status || 503}`);
  }
  const payload = await response.json().catch(() => null);
  if (!payload || !Array.isArray(payload.monthly_listener_rows)) {
    throw new Error('Spotify read model does not contain monthly listener history');
  }
  return payload.monthly_listener_rows;
}

export async function onRequestGet({ env }) {
  try {
    const rows = await materializedMonthlyListenerRows(env);
    return json({ ok: true, ...spotifyMonthlyListenersTrend(rows) });
  } catch (error) {
    console.error('spotify monthly listeners failed', error);
    return json({ ok: false, error: error?.message || 'spotify monthly listeners error' }, 503, {
      'cache-control': 'no-store',
    });
  }
}
