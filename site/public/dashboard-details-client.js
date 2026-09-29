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

function detailPayload() {
  if (!details?.ok) return null;
  return {
    ok: true,
    channel_id: detailsChannelId,
    history: Array.isArray(details.history) ? details.history : [],
    previous_day_history: details.previous_day_history || [],
    stream_5m_history: details.stream_5m_history || [],
    daily_summaries: details.daily_summaries || null,
  };
}

function dispatchDetails(source) {
  const payload = detailPayload();
  if (!payload) return;
  window.dispatchEvent(new CustomEvent('dashboard:details', {
    detail: { source, payload },
  }));
}

function restoreDetails(channelId) {
  if (details?.ok && detailsChannelId === channelId) return false;
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    const savedAt = Number(cached?.savedAt || 0);
    const payload = cached?.payload;
    if (!payload?.ok || Number(payload.channel_id) !== channelId) return false;
    if (!savedAt || Date.now() - savedAt > CACHE_MAX_AGE_MS) return false;
    details = payload;
    detailsAt = savedAt;
    detailsChannelId = channelId;
    return true;
  } catch {
    try { localStorage.removeItem(CACHE_KEY); } catch {}
    return false;
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
    dispatchDetails('details-network');
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
  if (restoreDetails(channelId)) dispatchDetails('details-cache');
  void refreshDetails(channelId);
}

window.addEventListener('dashboard:payload', (event) => {
  handleBasePayload(event?.detail?.payload);
});

handleBasePayload(window.__dashboardCurrentPayload);

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !basePayload?.ok || !currentViewVisible()) return;
  const channelId = channelIdFrom(basePayload);
  if (channelId != null) void refreshDetails(channelId);
});
