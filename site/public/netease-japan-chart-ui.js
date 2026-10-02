import {
  appendEmptyTableRow,
  byId,
  integerFormat,
} from './dashboard-ui-common.js?v=20261001.1';
import { renderRankHistoryChart } from './dashboard-rank-chart.js?v=20261002.1';

const ARTIST_LABELS = Object.freeze({
  sakurazaka46: '櫻坂46',
  nogizaka46: '乃木坂46',
  hinatazaka46: '日向坂46',
});
const GROUP_COLORS = Object.freeze({
  sakurazaka46: '#f3a6c8',
  nogizaka46: '#8264b0',
  hinatazaka46: '#9ecff3',
});
const ARTIST_ORDER = ['sakurazaka46','nogizaka46','hinatazaka46'];
const OUT_OF_CHART_RANK = 101;

let readModelPromise = null;
let requestId = 0;
let initialized = false;
let activeArtistFilter = 'all';
let lastPayload = null;

function providerDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function providerShortDate(value) {
  const date = providerDate(value);
  return date ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : String(value || '');
}

function providerDateText(value) {
  const date = providerDate(value);
  return date ? date.replaceAll('-', '/') : '-';
}

function replaceBody(id) {
  const node = byId(id);
  if (node) node.replaceChildren();
  return node;
}

function cell(text) {
  const td = document.createElement('td');
  td.textContent = String(text ?? '-');
  return td;
}

function row(values) {
  const tr = document.createElement('tr');
  values.forEach((value) => tr.append(cell(value)));
  return tr;
}

function artistVisible(canonicalArtist) {
  return activeArtistFilter === 'all' || canonicalArtist === activeArtistFilter;
}

function syncFilterButtons() {
  for (const button of document.querySelectorAll('[data-netease-artist-filter]')) {
    const active = button.dataset.neteaseArtistFilter === activeArtistFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

async function loadReadModel() {
  if (!readModelPromise) {
    readModelPromise = fetch('/api/regional-music', {
      headers:{ accept:'application/json' },
      cache:'default',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`regional music HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok) throw new Error(payload?.error || 'regional music read model unavailable');
      return payload;
    }).catch((error) => {
      readModelPromise = null;
      throw error;
    });
  }
  return readModelPromise;
}

function storedPeriods(chart, history) {
  const byPeriod = new Map();
  for (const item of Array.isArray(chart?.periods) ? chart.periods : []) {
    const period = providerDate(item?.period || item?.published_at);
    if (!period) continue;
    byPeriod.set(period, { period, date:providerDate(item?.published_at) || period });
  }
  if (!byPeriod.size) {
    for (const item of history) {
      const period = providerDate(item?.period || item?.published_at);
      if (!period || byPeriod.has(period)) continue;
      byPeriod.set(period, { period, date:providerDate(item?.published_at) || period });
    }
  }
  return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
}

function chartSeries(history, periods) {
  return ARTIST_ORDER.filter(artistVisible).map((canonicalArtist) => {
    const byPeriod = new Map();
    for (const item of history) {
      if (item?.canonical_artist !== canonicalArtist) continue;
      const period = providerDate(item?.period || item?.published_at);
      const rank = Number(item?.rank);
      if (!period || !Number.isFinite(rank) || rank < 1) continue;
      const previous = byPeriod.get(period);
      if (!previous || rank < previous.rank) byPeriod.set(period, { rank });
    }
    return {
      id:canonicalArtist,
      title:ARTIST_LABELS[canonicalArtist] || canonicalArtist,
      color:GROUP_COLORS[canonicalArtist],
      points:periods.map(({ period, date }) => ({
        date,
        rank:byPeriod.get(period)?.rank ?? OUT_OF_CHART_RANK,
      })),
    };
  }).filter((series) => series.points.length);
}

function setVisible(visible) {
  for (const id of ['neteaseJapanChartSection', 'neteaseJapanHistorySection']) {
    const section = byId(id);
    if (section) section.hidden = !visible;
  }
}

function renderHistory(history) {
  const body = replaceBody('neteaseJapanHistoryBody');
  if (!body) return;
  const ordered = history
    .filter((item) => artistVisible(item?.canonical_artist))
    .sort((a, b) => String(b.period || '').localeCompare(String(a.period || ''))
      || Number(a.rank) - Number(b.rank)
      || String(a.title || '').localeCompare(String(b.title || '')));
  if (!ordered.length) {
    appendEmptyTableRow(body, 'NetEase Cloud Music 日語榜のランクイン履歴はありません。', 4);
    return;
  }
  for (const item of ordered) {
    body.append(row([
      providerDateText(item.published_at || item.period),
      ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      Number.isFinite(Number(item.rank)) ? `${integerFormat.format(Number(item.rank))}位` : '-',
      item.title || '-',
    ]));
  }
}

function render(payload) {
  lastPayload = payload;
  syncFilterButtons();
  const chart = payload?.netease_japan_chart || {};
  const history = Array.isArray(chart.history) ? chart.history : [];
  const periods = storedPeriods(chart, history);
  const series = chartSeries(history, periods);
  const dates = periods.map((item) => item.date);

  renderRankHistoryChart({
    container:byId('neteaseJapanRankChart'),
    series,
    dates,
    height:320,
    margin:{ left:58, right:18, top:12, bottom:34 },
    yMax:OUT_OF_CHART_RANK,
    rankTicks:[1, 25, 50, 75, 100, OUT_OF_CHART_RANK],
    dateTickCount:5,
    ariaLabel:'NetEase Cloud Music 日語榜における選択グループの各週最高順位推移。保存済み週の圏外も含み、1位が上。',
    lineClass:'kugou-rank-line',
    emptyClass:'regional-music-rank-empty',
    emptyText:'NetEase Cloud Music 日語榜の順位履歴はまだありません。',
    rankLabel:(rank) => rank === OUT_OF_CHART_RANK ? '圏外' : `${rank}位`,
    dateLabel:providerShortDate,
    latestPoint:{ radius:() => 2.5 },
    legendContainer:byId('neteaseJapanRankLegend'),
  });

  renderHistory(history);
}

function bindFilters() {
  for (const button of document.querySelectorAll('[data-netease-artist-filter]')) {
    if (button.dataset.neteaseFilterBound === '1') continue;
    button.dataset.neteaseFilterBound = '1';
    button.addEventListener('click', () => {
      const next = button.dataset.neteaseArtistFilter || 'all';
      if (next === activeArtistFilter) return;
      activeArtistFilter = next;
      if (lastPayload && location.hash.slice(1) === 'netease_cloud_music') render(lastPayload);
      else syncFilterButtons();
    });
  }
}

async function renderForRoute() {
  const id = ++requestId;
  const visible = location.hash.slice(1) === 'netease_cloud_music';
  setVisible(visible);
  if (!visible) return;
  bindFilters();
  replaceBody('neteaseJapanRankLegend');
  replaceBody('neteaseJapanRankChart');
  replaceBody('neteaseJapanHistoryBody');
  try {
    const payload = await loadReadModel();
    if (id !== requestId || location.hash.slice(1) !== 'netease_cloud_music') return;
    render(payload);
  } catch {
    if (id !== requestId || location.hash.slice(1) !== 'netease_cloud_music') return;
    const historyBody = replaceBody('neteaseJapanHistoryBody');
    if (historyBody) appendEmptyTableRow(historyBody, 'NetEase Cloud Music 日語榜の履歴を取得できませんでした。', 4);
  }
}

export function initNeteaseJapanHistoryUi() {
  if (initialized) return;
  initialized = true;
  bindFilters();
  window.addEventListener('hashchange', renderForRoute);
  window.addEventListener('popstate', renderForRoute);
  void renderForRoute();
}
