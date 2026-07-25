const nativeFetch = window.fetch.bind(window);
const integer = new Intl.NumberFormat('ja-JP');
let trackRows = [];
let summaryFrame = 0;

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

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function summarizeCompleteTrackRows(rows) {
  const validRows = (Array.isArray(rows) ? rows : []).filter((row) => (
    row?.period_complete !== false && row?.play_count_excluded !== true
  ));
  const days = new Set();
  const tracks = new Set();
  let total = 0;
  let maximum = 0;
  for (const row of validRows) {
    if (row?.play_date) days.add(String(row.play_date));
    const identity = row?.track_key || row?.isrc || row?.spotify_id || row?.stationhead_track_id
      || `${row?.title || ''}|${row?.artist || ''}`;
    if (identity) tracks.add(String(identity));
    const count = Math.max(0, finite(row?.play_count) || 0);
    total += count;
    maximum = Math.max(maximum, count);
  }
  return { days: days.size, tracks: tracks.size, total, maximum };
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node && node.textContent !== value) node.textContent = value;
}

function applyTrackSummary() {
  summaryFrame = 0;
  if (location.hash !== '#tracks' || !trackRows.length) return;
  const summary = summarizeCompleteTrackRows(trackRows);
  setText('periodLabel', '有効日数');
  setText('maxLabel', '総再生回数');
  setText('streamLabel', '曲数');
  setText('memberLabel', '1曲の最多');
  setText('periods', integer.format(summary.days));
  setText('maxListener', summary.days ? integer.format(summary.total) : '—');
  setText('streamGrowth', summary.days ? integer.format(summary.tracks) : '—');
  setText('memberGrowth', summary.maximum ? `${integer.format(summary.maximum)}回` : '—');
}

function scheduleTrackSummary() {
  if (summaryFrame) return;
  summaryFrame = requestAnimationFrame(applyTrackSummary);
}

async function guardedFetch(input, init) {
  const url = requestUrl(input);
  if (!url || url.origin !== location.origin) return nativeFetch(input, init);

  if (url.pathname === '/api/track-history' && url.searchParams.get('latest') !== '1') {
    url.searchParams.set('ranking', '0');
  }
  if (url.pathname === '/api/sakurazaka46jp') {
    url.searchParams.set('revision', '2');
  }

  const response = await nativeFetch(requestWithUrl(input, url), init);
  if (url.pathname !== '/api/track-history' || !response.ok || url.searchParams.get('latest') === '1') {
    return response;
  }
  try {
    const data = await response.clone().json();
    if (data?.mode === 'tracks' && Array.isArray(data.rows)) {
      trackRows = data.rows;
      scheduleTrackSummary();
    }
  } catch {
    // The main history runtime owns response validation and error reporting.
  }
  return response;
}

for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
  const key = sessionStorage.key(index);
  if (key?.startsWith('sakurazaka46jp:v1:')) sessionStorage.removeItem(key);
}

window.fetch = guardedFetch;
window.addEventListener('hashchange', scheduleTrackSummary);
const summaryCards = document.getElementById('summaryCards');
if (summaryCards) {
  new MutationObserver(scheduleTrackSummary).observe(summaryCards, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}
