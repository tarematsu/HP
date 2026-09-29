const INTERNAL_URL = 'https://pages-read-model.internal/_internal/pages-response?key=apple-music';
const TRACK_TITLE_URL = 'https://pages-read-model.internal/_internal/pages-response?key=track-history-status';

const EMPTY_READ_MODEL = Object.freeze({
  ok: true,
  version: 1,
  source: null,
  artist_id: null,
  artist_name: '櫻坂46',
  snapshot_date: null,
  observed_at: null,
  regions: [],
  history: [],
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

function unavailable(message = 'Apple Music read model unavailable') {
  return jsonResponse({ ok: false, error: message }, 503, 'no-store');
}

function coldStart() {
  return jsonResponse(EMPTY_READ_MODEL, 200, 'public, max-age=15, s-maxage=60');
}

function integer(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function canonicalTitleMap(payload) {
  const titles = new Map();
  for (const row of Array.isArray(payload?.ranking) ? payload.ranking : []) {
    const trackId = integer(row?.track_id);
    const title = String(row?.title || '').trim();
    if (trackId == null || !title || title === '曲名不明' || titles.has(trackId)) continue;
    titles.set(trackId, title);
  }
  return titles;
}

function canonicalizeTrack(track, titles, { title = false } = {}) {
  if (!track || typeof track !== 'object') return track;
  const trackId = integer(track.track_id);
  if (trackId == null) return track;
  const normalized = { ...track, song_key: `track:${trackId}` };
  const canonicalTitle = titles.get(trackId);
  if (title && canonicalTitle) normalized.title = canonicalTitle;
  return normalized;
}

export function canonicalizeAppleMusicTitles(payload, titlePayload = {}) {
  if (!payload || typeof payload !== 'object') return payload;
  const titles = canonicalTitleMap(titlePayload);
  const regions = (Array.isArray(payload.regions) ? payload.regions : []).map((region) => ({
    ...region,
    tracks: (Array.isArray(region?.tracks) ? region.tracks : [])
      .map((track) => canonicalizeTrack(track, titles, { title: true })),
  }));
  const history = (Array.isArray(payload.history) ? payload.history : []).map((point) => {
    const pointRegions = point?.regions && typeof point.regions === 'object' ? point.regions : {};
    return {
      ...point,
      regions: Object.fromEntries(Object.entries(pointRegions).map(([code, tracks]) => [
        code,
        (Array.isArray(tracks) ? tracks : []).map((track) => canonicalizeTrack(track, titles)),
      ])),
    };
  });
  return { ...payload, regions, history };
}

async function optionalTrackTitles(service) {
  try {
    const response = await service.fetch(new Request(TRACK_TITLE_URL, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }));
    if (!response?.ok) return {};
    const payload = await response.json().catch(() => null);
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return {};
  }
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
    if (!response?.ok) return unavailable(`Apple Music read model returned HTTP ${response?.status || 503}`);

    const payload = await response.json().catch(() => null);
    if (!payload || typeof payload !== 'object') return unavailable('Apple Music read model returned invalid JSON');
    const titlePayload = await optionalTrackTitles(service);
    const normalized = canonicalizeAppleMusicTitles(payload, titlePayload);
    return jsonResponse(normalized, response.status, 'public, max-age=30, s-maxage=300, stale-while-revalidate=600');
  } catch (error) {
    console.error('apple music read model failed', error);
    return unavailable();
  }
}
