import {
  appendEmptyTableRow,
  byId,
  integerFormat,
  setText,
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

let readModelPromise = null;
let requestId = 0;
let initialized = false;

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

function periodText(value) {
  const period = periodParts(value);
  return period ? `${period.year}年第${period.week}週` : String(value || '-');
}

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

function qqSeries(history) {
  return ARTIST_ORDER.map((canonicalArtist) => {
    const byDate = new Map();
    for (const item of history) {
      if (item?.canonical_artist !== canonicalArtist) continue;
      const date = providerDate(item.published_at);
      const rank = Number(item.rank);
      if (!date || !Number.isFinite(rank) || rank < 1) continue;
      const previous = byDate.get(date);
      if (!previous || rank < previous.rank) byDate.set(date, { date, rank });
    }
    return {
      id:canonicalArtist,
      title:ARTIST_LABELS[canonicalArtist] || canonicalArtist,
      color:GROUP_COLORS[canonicalArtist],
      points:[...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }).filter((series) => series.points.length);
}

function setVisible(visible) {
  const chart = byId('qqJapanChartSection');
  const history = byId('qqJapanHistorySection');
  if (chart) chart.hidden = !visible;
  if (history) history.hidden = !visible;
}

function render(payload) {
  const chart = payload?.qq_japan_chart || {};
  const history = Array.isArray(chart.history) ? chart.history : [];
  const coverage = chart.coverage || {};
  const series = qqSeries(history);
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  const ranks = series.flatMap((item) => item.points.map((point) => point.rank));
  const maxRank = Math.max(1, ...ranks);
  const yMax = Math.max(10, Math.min(100, Math.ceil(maxRank / 10) * 10));
  const rankTicks = [...new Set([1, 25, 50, 75, 100, yMax].filter((rank) => rank <= yMax))].sort((a, b) => a - b);

  renderRankHistoryChart({
    container:byId('qqJapanRankChart'),
    series,
    dates,
    height:420,
    margin:{ left:58, right:18, top:18, bottom:38 },
    yMax,
    rankTicks,
    dateTickCount:5,
    ariaLabel:'QQ Music日本榜における櫻坂46、乃木坂46、日向坂46の各週最高順位推移。1位が上。',
    lineClass:'kugou-rank-line',
    emptyClass:'regional-music-rank-empty',
    emptyText:'QQ Music日本榜の順位履歴はまだありません。',
    rankLabel:(rank) => `${rank}位`,
    dateLabel:providerShortDate,
    latestPoint:{ radius:() => 2.5 },
    legendContainer:byId('qqJapanRankLegend'),
  });

  const entries = Number.isFinite(Number(coverage.entries)) ? Number(coverage.entries) : history.length;
  const storedPeriods = Number.isFinite(Number(coverage.stored_periods)) ? Number(coverage.stored_periods) : 0;
  setText('qqJapanCoverage', `保存期間: ${periodText(coverage.earliest_period)}〜${periodText(coverage.latest_period)} / 最終ランクイン: ${periodText(coverage.latest_rank_in_period)}（${integerFormat.format(storedPeriods)}週・${integerFormat.format(entries)}件）`);

  const body = replaceBody('qqJapanHistoryBody');
  if (!body) return;
  const ordered = [...history].sort((a, b) => comparePeriods(b.period, a.period)
    || Number(a.rank) - Number(b.rank)
    || String(a.title || '').localeCompare(String(b.title || '')));
  if (!ordered.length) {
    appendEmptyTableRow(body, 'QQ Music日本榜のランクイン履歴はまだありません。', 5);
    return;
  }
  for (const item of ordered) {
    body.append(row([
      periodText(item.period),
      ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      Number.isFinite(Number(item.rank)) ? `${integerFormat.format(Number(item.rank))}位` : '-',
      item.title || '-',
      providerDateText(item.published_at),
    ]));
  }
}

async function renderForRoute() {
  const id = ++requestId;
  const visible = location.hash.slice(1) === 'qq_music';
  setVisible(visible);
  if (!visible) return;
  replaceBody('qqJapanRankLegend');
  replaceBody('qqJapanRankChart');
  replaceBody('qqJapanHistoryBody');
  setText('qqJapanCoverage', '');
  try {
    const payload = await loadReadModel();
    if (id !== requestId || location.hash.slice(1) !== 'qq_music') return;
    render(payload);
  } catch {
    if (id !== requestId || location.hash.slice(1) !== 'qq_music') return;
    const body = replaceBody('qqJapanHistoryBody');
    if (body) appendEmptyTableRow(body, 'QQ Music日本榜の履歴を取得できませんでした。', 5);
  }
}

export function initQqJapanHistoryUi() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('hashchange', renderForRoute);
  window.addEventListener('popstate', renderForRoute);
  void renderForRoute();
}
