const browser = typeof window === 'undefined' ? null : window;
const previousFetch = browser?.fetch?.bind(browser) || null;
const CACHE_PREFIX = 'sh.history.v3:';
const BROADCAST_MODE = 'broadcasts';
const integer = new Intl.NumberFormat('ja-JP');

let rows = [];
let rowsUrl = '';
let renderTimer = 0;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function cacheUrl() {
  const from = document.getElementById('from')?.value || '';
  const to = document.getElementById('to')?.value || '';
  return `/api/history?${new URLSearchParams({ mode: BROADCAST_MODE, from, to })}`;
}

function restoreCachedRows(url = cacheUrl()) {
  try {
    const cached = JSON.parse(browser?.sessionStorage?.getItem(`${CACHE_PREFIX}${url}`) || 'null');
    if (!Array.isArray(cached?.data?.rows)) return false;
    rows = cached.data.rows;
    rowsUrl = url;
    return true;
  } catch {
    return false;
  }
}

function render() {
  if (!active()) return;
  const currentUrl = cacheUrl();
  if (rowsUrl !== currentUrl && !restoreCachedRows(currentUrl)) {
    rows = [];
    rowsUrl = currentUrl;
  }

  const maximums = rows
    .map((row) => finite(row?.listener_max))
    .filter((value) => value != null);
  const durations = rows
    .map(durationMinutes)
    .filter((value) => value != null);
  const averageDuration = durations.length
    ? durations.reduce((sum, value) => sum + value, 0) / durations.length
    : null;

  setText('streamLabel', '最大同接');
  setText('memberLabel', '平均時間');
  setText('streamGrowth', maximums.length ? integer.format(Math.max(...maximums)) : '—');
  setText('memberGrowth', averageDuration == null ? '—' : formatMinutes(averageDuration));
}

function scheduleRender(delay = 0) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, delay);
}

async function captureHistoryResponse(input, response) {
  if (!response?.ok) return;
  const url = requestUrl(input);
  if (!url || url.origin !== location.origin || url.pathname !== '/api/history') return;
  if (String(url.searchParams.get('mode') || '').toLowerCase() !== BROADCAST_MODE) return;
  try {
    const data = await response.clone().json();
    if (!data?.ok || !Array.isArray(data.rows)) return;
    rows = data.rows;
    rowsUrl = `${url.pathname}${url.search}`;
    scheduleRender();
  } catch {}
}

if (browser && previousFetch) {
  browser.fetch = async (input, init) => {
    const response = await previousFetch(input, init);
    void captureHistoryResponse(input, response);
    return response;
  };
}

const summaryCards = document.getElementById('summaryCards');
if (summaryCards) {
  new MutationObserver(() => {
    if (active()) scheduleRender();
  }).observe(summaryCards, { subtree: true, childList: true, characterData: true });
}

document.querySelector('[data-mode="broadcasts"]')?.addEventListener('click', () => scheduleRender());
document.getElementById('load')?.addEventListener('click', () => scheduleRender(50));
document.querySelectorAll('#rangePresets button').forEach((button) =>
  button.addEventListener('click', () => scheduleRender(50)));

scheduleRender();
