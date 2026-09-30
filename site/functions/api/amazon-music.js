const INTERNAL_URL = 'https://pages-read-model.internal/_internal/pages-response?key=amazon-music';

const EMPTY_READ_MODEL = Object.freeze({
  ok: true,
  version: 2,
  source: null,
  artist_id: null,
  artist_name: '櫻坂46',
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

export function addRankChanges(payload) {
  const date = String(payload?.snapshot_date || '');
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return payload;
  const previousDate = new Date(time - 86_400_000).toISOString().slice(0, 10);
  const previous = (Array.isArray(payload?.history) ? payload.history : [])
    .find((item) => item?.snapshot_date === previousDate);
  const previousRanks = new Map();
  for (const track of Array.isArray(previous?.tracks) ? previous.tracks : []) {
    const id = String(track?.amazon_music_id || '').trim();
    const rank = Number(track?.amazon_rank);
    if (id && Number.isSafeInteger(rank) && rank > 0) previousRanks.set(id, rank);
  }
  return {
    ...payload,
    tracks: (Array.isArray(payload?.tracks) ? payload.tracks : []).map((track) => {
      const id = String(track?.amazon_music_id || '').trim();
      const rank = Number(track?.amazon_rank);
      const previousRank = previousRanks.get(id);
      return {
        ...track,
        rank_change: id && Number.isSafeInteger(rank) && rank > 0 && Number.isSafeInteger(previousRank)
          ? previousRank - rank
          : null,
      };
    }),
  };
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

    const payload = await response.json();
    return jsonResponse(
      addRankChanges(payload),
      response.status,
      'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
    );
  } catch (error) {
    console.error('amazon music read model failed', error);
    return unavailable();
  }
}
