const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
  vary: 'accept-encoding',
};

function json(data, status = 200, headers = JSON_HEADERS) {
  return new Response(JSON.stringify(data), { status, headers });
}

async function loadDashboardReadModel(env) {
  const service = env?.PAGES_READ_MODEL_SERVICE;
  if (typeof service?.fetch !== 'function') return null;
  const url = new URL('https://pages-read-model.internal/_internal/pages-response');
  url.searchParams.set('key', 'dashboard');
  const response = await service.fetch(new Request(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  }));
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.ok ? payload : null;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const channelId = Number(url.searchParams.get('channel_id'));
  if (!Number.isFinite(channelId) || channelId <= 0) {
    return json({ ok: false, error: 'channel_id is required' }, 400, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
  }

  try {
    const payload = await loadDashboardReadModel(context.env);
    if (!payload) {
      return json({ ok: false, error: 'dashboard materialized response unavailable' }, 503, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
    }
    const modelChannelId = Number(payload?.latest?.channel_id);
    if (Number.isFinite(modelChannelId) && modelChannelId !== channelId) {
      return json({ ok: false, error: 'dashboard channel is unavailable' }, 404, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
    }
    return json({
      ok: true,
      generated_at: payload.generated_at ?? Date.now(),
      channel_id: channelId,
      history: Array.isArray(payload.history) ? payload.history : [],
      previous_day_history: Array.isArray(payload.previous_day_history)
        ? payload.previous_day_history
        : [],
      stream_5m_history: Array.isArray(payload.stream_5m_history)
        ? payload.stream_5m_history
        : [],
      daily_summaries: payload.daily_summaries ?? null,
    });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error?.message || 'dashboard details error' }, 500, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
  }
}
