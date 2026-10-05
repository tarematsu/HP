const CACHE_CONTROL = 'public, max-age=30, s-maxage=300, stale-while-revalidate=600';

function unavailable(service) {
  return new Response(JSON.stringify({ ok: false, error: 'music service materialized response unavailable', service }), {
    status: 503,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function fetchMaterialized(service, key) {
  const url = new URL('https://pages-read-model.internal/_internal/pages-response');
  url.searchParams.set('key', key);
  try {
    return await service.fetch(new Request(url, { method: 'GET', headers: { accept: 'application/json' } }));
  } catch {
    return null;
  }
}

function basePayload(payload) {
  return {
    ok: payload?.ok !== false,
    read_model_version: payload?.read_model_version,
    service: payload?.service,
    updated_at: payload?.updated_at,
    source_updated_at: payload?.source_updated_at,
    services: Array.isArray(payload?.services) ? payload.services : [],
  };
}

function compactTrack(track) {
  return {
    service: track?.service,
    service_track_id: track?.service_track_id,
    title: track?.title,
  };
}

function compactOrder(order) {
  return {
    service: order?.service,
    canonical_artist: order?.canonical_artist,
    service_track_id: order?.service_track_id,
    position: order?.position,
  };
}

function compactRegionalPayload(serviceId, payload) {
  const base = basePayload(payload);
  if (serviceId === 'kkbox') {
    return { ...base, kkbox_japanese_chart: payload?.kkbox_japanese_chart || {} };
  }
  if (serviceId === 'qq_music') {
    return {
      ...base,
      tracks: (Array.isArray(payload?.tracks) ? payload.tracks : []).map(compactTrack),
      artist_track_orders: (Array.isArray(payload?.artist_track_orders) ? payload.artist_track_orders : []).map(compactOrder),
      qq_japan_chart: payload?.qq_japan_chart || {},
      qq_anime_chart: payload?.qq_anime_chart || {},
    };
  }
  if (serviceId === 'kugou_music') {
    return {
      ...base,
      kugou_japan_chart: payload?.kugou_japan_chart || {},
      kugou_acg_chart: payload?.kugou_acg_chart || {},
    };
  }
  return payload;
}

async function compactResponse(response, serviceId) {
  if (!['kkbox', 'qq_music', 'kugou_music'].includes(serviceId)) return response;
  try {
    const payload = await response.json();
    const body = JSON.stringify(compactRegionalPayload(serviceId, payload));
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('cache-control', CACHE_CONTROL);
    headers.set('x-pages-payload', 'compact');
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return response;
  }
}

export async function musicServiceReadModelResponse(env, serviceId) {
  const service = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof service?.fetch !== 'function') return unavailable(serviceId);

  let response = await fetchMaterialized(service, `music-service:${serviceId}`);
  if (!response?.ok) response = await fetchMaterialized(service, `regional-music:${serviceId}`);
  if (!response?.ok) return unavailable(serviceId);

  response = await compactResponse(response, serviceId);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', CACHE_CONTROL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
