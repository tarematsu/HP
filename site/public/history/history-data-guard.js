const integer = new Intl.NumberFormat('ja-JP');
const nativeFetch = typeof window !== 'undefined' ? window.fetch.bind(window) : null;
let latestTrackRows = [];
let summaryFrame = 0;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function trackIdentity(row) {
  return String(
    row?.track_key || row?.isrc || row?.spotify_id || row?.stationhead_track_id
      || `${row?.title || ''}|${row?.artist || ''}`,
  );
}

export function summarizeTrackRows(rows) {
  const validRows = (Array.isArray(rows) ? rows : []).filter((row) => (
    row?.period_complete !== false && row?.play_count_excluded !== true
  ));
  const days = new Set(validRows.map((row) => row?.play_date).filter(Boolean));
  const tracks = new Set(validRows.map(trackIdentity).filter(Boolean));
  let total = 0;
  let maximum = 0;
  for (const row of validRows) {
    const count = Math.max(0, finite(row?.play_count) || 0);
    total += count;
    maximum = Math.max(maximum, count);
  }
  return {
    valid_day_count: days.size,
    track_count: tracks.size,
    total_play_count: total,
    maximum_play_count: maximum,
  };
}

function normalizedName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function representedSummary(summary, existing) {
  const startedAt = finite(summary?.started_at);
  const name = normalizedName(summary?.event_name);
  return existing.some((item) => {
    const itemStartedAt = finite(item?.started_at);
    if (startedAt != null && itemStartedAt != null && Math.abs(startedAt - itemStartedAt) <= 15 * 60_000) {
      return true;
    }
    return Boolean(name && name === normalizedName(item?.event_name));
  });
}

export function augmentOfficialBroadcastSeries(payload, summaryRows) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const existing = Array.isArray(source.series) ? source.series.map((item) => ({ ...item })) : [];
  let summaryOnlyCount = 0;

  for (const summary of Array.isArray(summaryRows) ? summaryRows : []) {
    if (representedSummary(summary, existing)) continue;
    const startedAt = finite(summary?.started_at);
    const endedAt = finite(summary?.ended_at);
    const average = finite(summary?.listener_avg);
    if (startedAt == null || average == null) continue;
    const durationMinutes = Math.max(1, Math.round(((endedAt ?? startedAt + 60_000) - startedAt) / 60_000));
    existing.push({
      event_name: `${summary?.event_name || '公式ステヘ'}（平均値）`,
      started_at: startedAt,
      points: [[0, average], [durationMinutes, average]],
      source_samples: Math.max(0, Math.trunc(finite(summary?.sample_count) || 0)),
      source: 'official_broadcast_summary',
      summary_only: true,
      listener_avg: average,
      listener_max: finite(summary?.listener_max),
    });
    summaryOnlyCount += 1;
  }

  existing.sort((left, right) => (finite(left?.started_at) || 0) - (finite(right?.started_at) || 0));
  return {
    ...source,
    series: existing,
    event_count: existing.length,
    point_count: existing.reduce((total, item) => total + (Array.isArray(item?.points) ? item.points.length : 0), 0),
    summary_only_event_count: summaryOnlyCount,
  };
}

function requestUrl(input) {
  try {
    return new URL(typeof input === 'string' || input instanceof URL ? input : input?.url, location.href);
  } catch {
    return null;
  }
}

function requestWithUrl(input, url) {
  return input instanceof Request ? new Request(url, input) : url.href;
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node && node.textContent !== value) node.textContent = value;
}

function applyTrackSummary() {
  summaryFrame = 0;
  if (location.hash !== '#tracks' || !latestTrackRows.length) return;
  const summary = summarizeTrackRows(latestTrackRows);
  setText('periodLabel', '有効日数');
  setText('maxLabel', '総再生回数');
  setText('streamLabel', '曲数');
  setText('memberLabel', '1曲の最多');
  setText('periods', integer.format(summary.valid_day_count));
  setText('maxListener', summary.valid_day_count ? integer.format(summary.total_play_count) : '—');
  setText('streamGrowth', summary.valid_day_count ? integer.format(summary.track_count) : '—');
  setText('memberGrowth', summary.maximum_play_count ? `${integer.format(summary.maximum_play_count)}回` : '—');
}

function scheduleTrackSummary() {
  if (summaryFrame || typeof requestAnimationFrame !== 'function') return;
  summaryFrame = requestAnimationFrame(applyTrackSummary);
}

async function fetchTrackHistory(input, init, url) {
  if (url.searchParams.get('latest') !== '1') url.searchParams.set('ranking', '0');
  const response = await nativeFetch(requestWithUrl(input, url), init);
  if (!response.ok || url.searchParams.get('latest') === '1') return response;
  try {
    const data = await response.clone().json();
    if (data?.mode === 'tracks' && Array.isArray(data.rows)) {
      latestTrackRows = data.rows;
      scheduleTrackSummary();
    }
  } catch {
    // The page's normal error handling owns malformed responses.
  }
  return response;
}

async function fetchOfficialSeries(input, init, url) {
  const response = await nativeFetch(requestWithUrl(input, url), init);
  if (!response.ok) return response;
  try {
    const payload = await response.clone().json();
    const params = new URLSearchParams({
      mode: 'broadcasts',
      from: url.searchParams.get('from') || '2024-05-01',
      to: url.searchParams.get('to') || new Date().toISOString().slice(0, 10),
    });
    const summaryResponse = await nativeFetch(`/api/history?${params}`, {
      headers: { accept: 'application/json' },
    });
    if (!summaryResponse.ok) return response;
    const summary = await summaryResponse.json();
    const augmented = augmentOfficialBroadcastSeries(payload, summary?.rows);
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(augmented), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

export function installHistoryDataGuard() {
  if (!nativeFetch || typeof window === 'undefined') return;
  window.fetch = async (input, init) => {
    const url = requestUrl(input);
    if (!url || url.origin !== location.origin) return nativeFetch(input, init);
    if (url.pathname === '/api/track-history') return fetchTrackHistory(input, init, url);
    if (url.pathname === '/api/sakurazaka46jp') return fetchOfficialSeries(input, init, url);
    return nativeFetch(input, init);
  };

  window.addEventListener('hashchange', scheduleTrackSummary);
  const summaryRoot = document.getElementById('summary');
  if (summaryRoot) {
    new MutationObserver(scheduleTrackSummary).observe(summaryRoot, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
}

installHistoryDataGuard();
