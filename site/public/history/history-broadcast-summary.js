const browser = typeof window === 'undefined' ? null : window;
const previousFetch = browser?.fetch?.bind(browser) || null;
const SERIES_CACHE_PREFIX = 'sakurazaka46jp:v1:';
const BROADCAST_MODE = 'broadcasts';
const LIVE_REFRESH_MS = 15_000;
const integer = new Intl.NumberFormat('ja-JP');

let rows = [];
let renderTimer = 0;
let liveRefreshTimer = 0;
let liveCollectionActive = null;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function epochMs(value) {
  const parsed = finite(value);
  if (parsed == null || parsed <= 0) return null;
  return parsed < 100_000_000_000 ? parsed * 1000 : parsed;
}

function requestUrl(input) {
  try {
    const value = typeof input === 'string' || input instanceof URL ? input : input?.url;
    return new URL(value, browser?.location?.href || 'https://history.invalid/');
  } catch {
    return null;
  }
}

function active() {
  return document.querySelector('#modeTabs button.active[data-mode="broadcasts"]') != null;
}

function setText(id, value) {
  const node = document.getElementById(id);
  const text = String(value);
  if (node && node.textContent !== text) node.textContent = text;
}

function durationMinutes(row) {
  const startedAt = finite(row?.started_at);
  const endedAt = finite(row?.ended_at);
  if (startedAt == null || endedAt == null || endedAt < startedAt) return null;
  return (endedAt - startedAt) / 60_000;
}

function formatMinutes(value) {
  const rounded = Math.max(0, Math.round(finite(value) || 0));
  if (rounded < 60) return `${rounded}分`;
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  return minutes ? `${hours}時間${minutes}分` : `${hours}時間`;
}

function render() {
  if (!active()) return;
  const maximums = rows.map((row) => finite(row?.listener_max)).filter((value) => value != null);
  const durations = rows.map(durationMinutes).filter((value) => value != null);
  const averageDuration = durations.length
    ? durations.reduce((sum, value) => sum + value, 0) / durations.length
    : null;

  setText('streamLabel', '最大同接');
  setText('memberLabel', '平均所要時間');
  setText('streamGrowth', maximums.length ? integer.format(Math.max(...maximums)) : '—');
  setText('memberGrowth', averageDuration == null ? '—' : formatMinutes(averageDuration));
}

function scheduleRender(delay = 0) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, delay);
}

function mergeLiveSeries(basePayload, statusPayload) {
  if (!basePayload?.ok || !statusPayload?.ok || statusPayload.collection_active !== true) {
    return basePayload;
  }
  const samples = Array.isArray(statusPayload.samples) ? statusPayload.samples : [];
  const anchor = samples.find((sample) =>
    epochMs(sample?.broadcast_start_time) != null && finite(sample?.listener_count) != null);
  if (!anchor) return basePayload;

  const start = epochMs(anchor.broadcast_start_time);
  const broadcastId = String(anchor.broadcast_id || '');
  const pointsByMinute = new Map();
  for (const sample of samples) {
    if (broadcastId && sample?.broadcast_id && String(sample.broadcast_id) !== broadcastId) continue;
    const sampleStart = epochMs(sample?.broadcast_start_time);
    if (sampleStart != null && Math.abs(sampleStart - start) > 5 * 60_000) continue;
    const observedAt = epochMs(sample?.observed_at);
    const listener = finite(sample?.listener_count);
    if (observedAt == null || listener == null || observedAt < start) continue;
    const minute = Math.max(0, Math.floor((observedAt - start) / 60_000));
    const previous = pointsByMinute.get(minute);
    if (!previous || observedAt >= previous.observedAt) {
      pointsByMinute.set(minute, { observedAt, listener });
    }
  }
  if (!pointsByMinute.size) return basePayload;

  const series = Array.isArray(basePayload.series)
    ? basePayload.series.map((item) => ({ ...item }))
    : [];
  let index = series.findIndex((item) => {
    const itemStart = finite(item?.started_at);
    return itemStart != null && Math.abs(itemStart - start) <= 15 * 60_000;
  });
  if (index < 0) {
    series.push({ event_name: '公式リスパ', started_at: start, points: [], source: 'live_status' });
    index = series.length - 1;
  }

  const mergedPoints = new Map();
  for (const point of Array.isArray(series[index].points) ? series[index].points : []) {
    const minute = finite(point?.[0]);
    const listener = finite(point?.[1]);
    if (minute != null && listener != null) mergedPoints.set(minute, listener);
  }
  for (const [minute, point] of pointsByMinute) mergedPoints.set(minute, point.listener);

  series[index] = {
    ...series[index],
    started_at: start,
    points: [...mergedPoints.entries()].sort((left, right) => left[0] - right[0]),
    source: 'live_status',
  };
  series.sort((left, right) => (finite(left?.started_at) || 0) - (finite(right?.started_at) || 0));
  return { ...basePayload, series };
}

function clearLiveRefresh() {
  clearTimeout(liveRefreshTimer);
  liveRefreshTimer = 0;
}

function scheduleLiveRefresh(delay = LIVE_REFRESH_MS) {
  clearLiveRefresh();
  if (!active() || document.visibilityState === 'hidden' || liveCollectionActive !== true) return;
  liveRefreshTimer = setTimeout(() => {
    liveRefreshTimer = 0;
    if (!active() || document.visibilityState === 'hidden' || liveCollectionActive !== true) return;
    clearSeriesCache();
    document.getElementById('load')?.click();
    scheduleLiveRefresh();
  }, delay);
}

function updateLiveCollectionState(statusPayload) {
  liveCollectionActive = statusPayload?.collection_active === true;
  if (!liveCollectionActive) {
    clearLiveRefresh();
    return;
  }
  if (active() && document.visibilityState !== 'hidden' && !liveRefreshTimer) scheduleLiveRefresh();
}

async function mergeLiveStatusResponse(input, baseResponse) {
  const url = requestUrl(input);
  if (!baseResponse?.ok || !url || url.origin !== location.origin || url.pathname !== '/api/sakurazaka46jp') {
    return baseResponse;
  }
  try {
    const statusResponse = await previousFetch('/api/sakurazaka46jp-status', {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!statusResponse.ok) return baseResponse;
    const [basePayload, statusPayload] = await Promise.all([
      baseResponse.clone().json(),
      statusResponse.json(),
    ]);
    updateLiveCollectionState(statusPayload);
    if (statusPayload.collection_active !== true) return baseResponse;
    const mergedPayload = mergeLiveSeries(basePayload, statusPayload);
    return new Response(JSON.stringify(mergedPayload), {
      status: baseResponse.status,
      statusText: baseResponse.statusText,
      headers: baseResponse.headers,
    });
  } catch {
    return baseResponse;
  }
}

function clearSeriesCache() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(SERIES_CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
  } catch {}
}

if (browser && previousFetch) {
  browser.fetch = async (input, init) => {
    const baseResponse = await previousFetch(input, init);
    return mergeLiveStatusResponse(input, baseResponse);
  };
}

window.addEventListener('history:data-loaded', (event) => {
  const detail = event?.detail || {};
  if (detail.mode !== BROADCAST_MODE || !detail.data?.ok || !Array.isArray(detail.data.rows)) return;
  rows = detail.data.rows;
  scheduleRender();
});

document.querySelector('[data-mode="broadcasts"]')?.addEventListener('click', () => {
  if (!active()) {
    clearLiveRefresh();
    return;
  }
  scheduleRender();
  if (liveCollectionActive === true) scheduleLiveRefresh();
});
document.getElementById('load')?.addEventListener('click', () => scheduleRender(50));
document.querySelectorAll('#rangePresets button').forEach((button) =>
  button.addEventListener('click', () => scheduleRender(50)));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') clearLiveRefresh();
  else if (active() && liveCollectionActive === true) scheduleLiveRefresh();
});
