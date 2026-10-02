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
const QQ_CHART_CADENCE = '毎週木曜日18:00';

let readModelPromise = null;
let requestId = 0;
let initialized = false;
let activeArtistFilter = 'all';
let lastPayload = null;

function periodParts(value) {
  const match = String(value || '').match(/^(\d{4})_(\d{1,2})$/);
  return match ? { year:Number(match[1]), week:Number(match[2]) } : null;
}

function comparePeriods(left, right) {
  const a = periodParts(left);
  const b = periodParts(right);
  if (!a || !b) return String(left || '').localeCompare(String(right || ''));
  return (a.year - b.year) || (a.week - b.week);
}

function providerDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
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
  for (const button of document.querySelectorAll('[data-qq-artist-filter]')) {
    const active = button.dataset.qqArtistFilter === activeArtistFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function syncCadenceLabel() {
  if (location.hash.slice(1) !== 'qq_music') return;
  const cadence = byId('regionalMusicChartCadence');
  if (cadence && cadence.textContent !== QQ_CHART_CADENCE) cadence.textContent = QQ_CHART_CADENCE;
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

function qqStoredPeriods(chart, history) {
  const byPeriod = new Map();
  for (const item of Array.isArray(chart?.periods) ? chart.periods : []) {
    const period = String(item?.period || '');
    const date = providerDate(item?.published_at);
    if (!periodParts(period) || !date) continue;
    byPeriod.set(period, { period, date });
  }
  if (!byPeriod.size) {
    for (const item of history) {
      const period = String(item?.period || '');
      const date = providerDate(item?.published_at);
      if (!periodParts(period) || !date || byPeriod.has(period)) continue;
      byPeriod.set(period, { period, date });
    }
  }
  return [...byPeriod.values()].sort((a, b) => comparePeriods(a.period, b.period));
}

function qqSeries(history, periods) {
  return ARTIST_ORDER.filter(artistVisible).map((canonicalArtist) => {
    const byPeriod = new Map();
    for (const item of history) {
      if (item?.canonical_artist !== canonicalArtist) continue;
      const period = String(item?.period || '');
      const rank = Number(item.rank);
      if (!periodParts(period) || !Number.isFinite(rank) || rank < 1) continue;
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
  for (const id of ['qqJapanChartSection', 'qqJapanHistorySection', 'qqArtistPopularitySection']) {
    const section = byId(id);
    if (section) section.hidden = !visible;
  }
}

function renderHistory(history) {
  const body = replaceBody('qqJapanHistoryBody');
  if (!body) return;
  const ordered = history
    .filter((item) => artistVisible(item?.canonical_artist))
    .sort((a, b) => comparePeriods(b.period, a.period)
      || Number(a.rank) - Number(b.rank)
      || String(a.title || '').localeCompare(String(b.title || '')));
  if (!ordered.length) {
    appendEmptyTableRow(body, 'QQ Music 日本榜のランクイン履歴はありません。', 4);
    return;
  }
  for (const item of ordered) {
    body.append(row([
      providerDateText(item.published_at),
      ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      Number.isFinite(Number(item.rank)) ? `${integerFormat.format(Number(item.rank))}位` : '-',
      item.title || '-',
    ]));
  }
}

function renderPopularity(payload) {
  const body = replaceBody('qqArtistPopularityBody');
  if (!body) return;
  const trackById = new Map((Array.isArray(payload?.tracks) ? payload.tracks : [])
    .filter((item) => item?.service === 'qq_music')
    .map((item) => [String(item.service_track_id || ''), item]));
  const rows = (Array.isArray(payload?.artist_track_orders) ? payload.artist_track_orders : [])
    .filter((item) => item?.service === 'qq_music')
    .filter((item) => ARTIST_ORDER.includes(item?.canonical_artist))
    .filter((item) => artistVisible(item?.canonical_artist))
    .filter((item) => Number.isFinite(Number(item?.position)) && Number(item.position) > 0)
    .sort((a, b) => ARTIST_ORDER.indexOf(a.canonical_artist) - ARTIST_ORDER.indexOf(b.canonical_artist)
      || Number(a.position) - Number(b.position)
      || String(trackById.get(String(a.service_track_id || ''))?.title || '').localeCompare(String(trackById.get(String(b.service_track_id || ''))?.title || '')));
  if (!rows.length) {
    appendEmptyTableRow(body, 'QQ Music のアーティスト別人気曲順位はありません。', 3);
    return;
  }
  for (const item of rows) {
    const track = trackById.get(String(item.service_track_id || ''));
    body.append(row([
      ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      `${integerFormat.format(Number(item.position))}位`,
      track?.title || item.service_track_id || '-',
    ]));
  }
}

function render(payload) {
  lastPayload = payload;
  syncFilterButtons();
  syncCadenceLabel();
  const chart = payload?.qq_japan_chart || {};
  const history = Array.isArray(chart.history) ? chart.history : [];
  const periods = qqStoredPeriods(chart, history);
  const series = qqSeries(history, periods);
  const dates = periods.map((item) => item.date);

  renderRankHistoryChart({
    container:byId('qqJapanRankChart'),
    series,
    dates,
    height:320,
    margin:{ left:58, right:18, top:12, bottom:34 },
    yMax:OUT_OF_CHART_RANK,
    rankTicks:[1, 25, 50, 75, 100, OUT_OF_CHART_RANK],
    dateTickCount:5,
    ariaLabel:'QQ Music 日本榜における選択グループの更新日別最高順位推移。保存済み更新日の圏外も含み、1位が上。',
    lineClass:'kugou-rank-line',
    emptyClass:'regional-music-rank-empty',
    emptyText:'QQ Music 日本榜の順位履歴はまだありません。',
    rankLabel:(rank) => rank === OUT_OF_CHART_RANK ? '圏外' : `${rank}位`,
    dateLabel:providerDateText,
    latestPoint:{ radius:() => 2.5 },
    legendContainer:byId('qqJapanRankLegend'),
  });

  renderHistory(history);
  renderPopularity(payload);
}

function bindFilters() {
  for (const button of document.querySelectorAll('[data-qq-artist-filter]')) {
    if (button.dataset.qqFilterBound === '1') continue;
    button.dataset.qqFilterBound = '1';
    button.addEventListener('click', () => {
      const next = button.dataset.qqArtistFilter || 'all';
      if (next === activeArtistFilter) return;
      activeArtistFilter = next;
      if (lastPayload && location.hash.slice(1) === 'qq_music') render(lastPayload);
      else syncFilterButtons();
    });
  }
}

async function renderForRoute() {
  const id = ++requestId;
  const visible = location.hash.slice(1) === 'qq_music';
  setVisible(visible);
  if (!visible) return;
  syncCadenceLabel();
  bindFilters();
  replaceBody('qqJapanRankLegend');
  replaceBody('qqJapanRankChart');
  replaceBody('qqJapanHistoryBody');
  replaceBody('qqArtistPopularityBody');
  try {
    const payload = await loadReadModel();
    if (id !== requestId || location.hash.slice(1) !== 'qq_music') return;
    render(payload);
  } catch {
    if (id !== requestId || location.hash.slice(1) !== 'qq_music') return;
    const historyBody = replaceBody('qqJapanHistoryBody');
    if (historyBody) appendEmptyTableRow(historyBody, 'QQ Music 日本榜の履歴を取得できませんでした。', 4);
    const popularityBody = replaceBody('qqArtistPopularityBody');
    if (popularityBody) appendEmptyTableRow(popularityBody, 'QQ Music の人気曲順位を取得できませんでした。', 3);
  }
}

export function initQqJapanHistoryUi() {
  if (initialized) return;
  initialized = true;
  bindFilters();
  const cadence = byId('regionalMusicChartCadence');
  if (cadence) {
    new MutationObserver(syncCadenceLabel).observe(cadence, { childList:true, characterData:true, subtree:true });
  }
  window.addEventListener('hashchange', renderForRoute);
  window.addEventListener('popstate', renderForRoute);
  void renderForRoute();
}
