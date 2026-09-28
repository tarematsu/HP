const CACHE_KEY = 'sh.dashboard.details.v1';
const CACHE_MAX_AGE_MS = 15 * 60_000;
const NETWORK_MAX_AGE_MS = 4 * 60_000;

let basePayload = null;
let details = null;
let detailsAt = 0;
let detailsChannelId = null;
let requestPromise = null;

function currentViewVisible() {
  const view = document.getElementById('currentView');
  return Boolean(view && !view.hidden);
}

function channelIdFrom(payload) {
  const value = Number(payload?.latest?.channel_id ?? payload?.channel_id);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function dispatchCombined(source) {
  if (!basePayload?.ok || !details?.ok) return;
  const channelId = channelIdFrom(basePayload);
  if (channelId == null || channelId !== detailsChannelId) return;
  window.dispatchEvent(new CustomEvent('dashboard:payload', {
    detail: {
      source,
      payload: {
        ...basePayload,
        history: Array.isArray(details.history) ? details.history : basePayload.history,
        previous_day_history: details.previous_day_history || [],
        stream_5m_history: details.stream_5m_history || [],
        daily_summaries: details.daily_summaries || null,
      },
    },
  }));
}

function restoreDetails(channelId) {
  if (details?.ok && detailsChannelId === channelId) return;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    const savedAt = Number(cached?.savedAt || 0);
    const payload = cached?.payload;
    if (!payload?.ok || Number(payload.channel_id) !== channelId) return;
    if (!savedAt || Date.now() - savedAt > CACHE_MAX_AGE_MS) return;
    details = payload;
    detailsAt = savedAt;
    detailsChannelId = channelId;
  } catch {
    try { localStorage.removeItem(CACHE_KEY); } catch {}
  }
}

function saveDetails(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), payload }));
  } catch {}
}

async function refreshDetails(channelId) {
  if (!currentViewVisible()) return;
  if (requestPromise) return requestPromise;
  if (details?.ok && detailsChannelId === channelId && Date.now() - detailsAt < NETWORK_MAX_AGE_MS) return;

  requestPromise = (async () => {
    const response = await fetch(`/api/dashboard-details?channel_id=${encodeURIComponent(channelId)}`, {
      headers: { accept: 'application/json' },
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `dashboard details ${response.status}`);
    if (Number(payload.channel_id) !== channelId) return;
    details = payload;
    detailsAt = Date.now();
    detailsChannelId = channelId;
    saveDetails(payload);
    dispatchCombined('details-network');
  })().catch((error) => {
    console.warn('dashboard details unavailable', error);
  }).finally(() => {
    requestPromise = null;
  });
  return requestPromise;
}

function handleBasePayload(payload) {
  if (!payload?.ok) return;
  basePayload = payload;
  const channelId = channelIdFrom(payload);
  if (channelId == null) return;
  if (detailsChannelId !== channelId) {
    details = null;
    detailsAt = 0;
    detailsChannelId = channelId;
  }
  restoreDetails(channelId);
  if (details?.ok) dispatchCombined('details-cache');
  void refreshDetails(channelId);
}

window.addEventListener('dashboard:payload', (event) => {
  const source = String(event?.detail?.source || '');
  if (source.startsWith('details-')) return;
  handleBasePayload(event?.detail?.payload);
});

handleBasePayload(window.__dashboardCurrentPayload);

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !basePayload?.ok || !currentViewVisible()) return;
  const channelId = channelIdFrom(basePayload);
  if (channelId != null) void refreshDetails(channelId);
});
