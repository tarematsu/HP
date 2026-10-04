import {
  appendEmptyTableRow,
  byId,
  integerFormat,
} from './dashboard-ui-common.js?v=20261001.1';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';
import { renderRankHistoryChart } from './dashboard-rank-chart.js?v=20261003.1';
import {
  MUSIC_ARTIST_LABELS,
  SAKAMICHI_GROUP_COLORS,
  loadRegionalMusicReadModel,
  replaceMusicTableBody,
} from './music-service-runtime-common.js?v=20261004.1';

const SERVICE = 'kkbox';
const SECTION_IDS = ['kkboxJapaneseChartSection', 'kkboxJapaneseHistorySection'];
const BODY_ID = 'kkboxJapaneseHistoryBody';
const OUT_OF_CHART_RANK = 101;
const CHART_START_DATE = '2020-10-01';
const ARTIST_ORDER = Object.freeze([
  'sakurazaka46',
  'nogizaka46',
  'hinatazaka46',
]);

let activeRequest = 0;
let activeTerritory = 'tw';
let activePeriodType = 'weekly';
let activeChartType = 'newrelease';
let activeArtistFilter = 'all';
let lastPayload = null;

function dateOnly(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function dateText(value) {
  const date = dateOnly(value);
  return date ? date.replaceAll('-', '/') : '-';
}

function itemArtists(item) {
  return Array.isArray(item?.canonical_artists)
    ? item.canonical_artists.filter((artist) => ARTIST_ORDER.includes(artist))
    : [];
}

function artistText(item) {
  const artists = itemArtists(item);
  return artists.length ? artists.map((artist) => MUSIC_ARTIST_LABELS[artist] || artist).join(' / ') : '-';
}

function seriesSelected(item) {
  return item?.territory === activeTerritory
    && item?.period_type === activePeriodType
    && item?.chart_type === activeChartType;
}

function artistVisible(item) {
  const artists = itemArtists(item);
  if (!artists.length) return false;
  return activeArtistFilter === 'all' || artists.includes(activeArtistFilter);
}

function selectedPeriods(chart, history) {
  const dates = new Set((Array.isArray(chart?.periods) ? chart.periods : [])
    .filter(seriesSelected)
    .filter((item) => !item?.status || item.status === 'ok')
    .map((item) => dateOnly(item?.period))
    .filter((date) => date && date >= CHART_START_DATE));
  if (!dates.size) {
    for (const item of history) {
      if (!seriesSelected(item)) continue;
      const date = dateOnly(item?.period);
      if (date && date >= CHART_START_DATE) dates.add(date);
    }
  }
  return [...dates].sort();
}

function rankSeries(history, dates) {
  const visibleArtists = activeArtistFilter === 'all'
    ? ARTIST_ORDER
    : ARTIST_ORDER.filter((artist) => artist === activeArtistFilter);
  return visibleArtists.map((canonicalArtist) => {
    const byDate = new Map();
    for (const item of history) {
      if (!seriesSelected(item) || !itemArtists(item).includes(canonicalArtist)) continue;
      const date = dateOnly(item?.period);
      const rank = Number(item?.rank);
      if (!date || date < CHART_START_DATE || !Number.isFinite(rank) || rank < 1) continue;
      const previous = byDate.get(date);
      if (previous == null || rank < previous) byDate.set(date, rank);
    }
    return {
      id: canonicalArtist,
      title: MUSIC_ARTIST_LABELS[canonicalArtist] || canonicalArtist,
      color: SAKAMICHI_GROUP_COLORS[canonicalArtist],
      points: dates.map((date) => ({ date, rank: byDate.get(date) ?? OUT_OF_CHART_RANK })),
    };
  }).filter((series) => series.points.length);
}

function renderChart(chart) {
  const history = Array.isArray(chart?.history) ? chart.history : [];
  const dates = selectedPeriods(chart, history);
  const series = rankSeries(history, dates);
  renderRankHistoryChart({
    container: byId('kkboxJapaneseRankChart'),
    series,
    dates,
    height: 320,
    margin: { left: 58, right: 18, top: 12, bottom: 34 },
    yMax: OUT_OF_CHART_RANK,
    rankTicks: [1, 25, 50, 75, OUT_OF_CHART_RANK],
    dateTickCount: 5,
    ariaLabel: 'KKBOX 日語チャートにおける選択条件・選択グループの最高順位推移。2020年10月以降の取得済み更新日の圏外も含み、1位が上。',
    lineClass: 'kugou-rank-line',
    emptyClass: 'regional-music-rank-empty',
    emptyText: 'KKBOX 日語チャートの順位履歴はまだありません。',
    rankLabel: (rank) => rank === OUT_OF_CHART_RANK ? '圏外' : `${rank}位`,
    dateLabel: dateText,
    latestPoint: { radius: () => 2.5 },
    legendContainer: byId('kkboxJapaneseRankLegend'),
  });
}

function renderHistory(chart) {
  const body = replaceMusicTableBody(BODY_ID);
  if (!body) return;
  const history = Array.isArray(chart?.history) ? chart.history : [];
  const ordered = history
    .filter(seriesSelected)
    .filter(artistVisible)
    .sort((a, b) => String(b?.period || '').localeCompare(String(a?.period || ''))
      || Number(a?.rank || Infinity) - Number(b?.rank || Infinity)
      || String(a?.title || '').localeCompare(String(b?.title || '')));
  if (!ordered.length) {
    appendEmptyTableRow(body, 'KKBOX 日語チャートのランクイン履歴はありません。', 4);
    return;
  }
  for (const item of ordered) {
    const rank = Number(item?.rank);
    appendTableRow(body, [
      dateText(item?.period),
      artistText(item),
      Number.isFinite(rank) && rank > 0 ? `${integerFormat.format(rank)}位` : '-',
      item?.title || '-',
    ]);
  }
}

function filterValue(button, attribute) {
  return String(button.getAttribute(`data-${attribute}`) || '');
}

function syncFilterButtons() {
  const filters = [
    ['kkbox-territory-filter', activeTerritory],
    ['kkbox-period-filter', activePeriodType],
    ['kkbox-chart-filter', activeChartType],
    ['kkbox-artist-filter', activeArtistFilter],
  ];
  for (const [attribute, current] of filters) {
    for (const button of document.querySelectorAll(`[data-${attribute}]`)) {
      const active = filterValue(button, attribute) === current;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }
}

function bindFilter(attribute, current, update) {
  for (const button of document.querySelectorAll(`[data-${attribute}]`)) {
    if (button.dataset.kkboxFilterBound === '1') continue;
    button.dataset.kkboxFilterBound = '1';
    button.addEventListener('click', () => {
      const next = filterValue(button, attribute);
      if (!next || next === current()) return;
      update(next);
      if (lastPayload && location.hash.slice(1) === SERVICE) renderKkboxHistory(lastPayload);
      else syncFilterButtons();
    });
  }
}

function bindFilters() {
  bindFilter('kkbox-territory-filter', () => activeTerritory, (value) => { activeTerritory = value; });
  bindFilter('kkbox-period-filter', () => activePeriodType, (value) => { activePeriodType = value; });
  bindFilter('kkbox-chart-filter', () => activeChartType, (value) => { activeChartType = value; });
  bindFilter('kkbox-artist-filter', () => activeArtistFilter, (value) => { activeArtistFilter = value; });
}

function setVisible(visible) {
  for (const id of SECTION_IDS) {
    const section = byId(id);
    if (section) section.hidden = !visible;
  }
  if (!visible) return;
  const view = byId('regionalMusicView');
  const genericTables = byId('regionalMusicGenericTables');
  const compactMeta = byId('regionalMusicCompactMeta');
  view?.classList.add('is-chart-compact');
  if (genericTables) genericTables.hidden = true;
  if (compactMeta) compactMeta.hidden = false;
}

export function renderKkboxHistory(payload) {
  lastPayload = payload;
  syncFilterButtons();
  const chart = payload?.kkbox_japanese_chart || {};
  renderChart(chart);
  renderHistory(chart);
}

async function syncKkboxHistory() {
  const request = ++activeRequest;
  const visible = location.hash.slice(1) === SERVICE;
  setVisible(visible);
  if (!visible) return;
  bindFilters();
  replaceMusicTableBody('kkboxJapaneseRankLegend');
  replaceMusicTableBody('kkboxJapaneseRankChart');
  replaceMusicTableBody(BODY_ID);
  try {
    const payload = await loadRegionalMusicReadModel(SERVICE);
    if (request === activeRequest && location.hash.slice(1) === SERVICE) renderKkboxHistory(payload);
  } catch {
    if (request !== activeRequest || location.hash.slice(1) !== SERVICE) return;
    const body = replaceMusicTableBody(BODY_ID);
    if (body) appendEmptyTableRow(body, 'KKBOX履歴データを取得できませんでした。', 4);
    const chart = byId('kkboxJapaneseRankChart');
    if (chart) chart.textContent = 'KKBOX順位履歴を取得できませんでした。';
  }
}

export function initKkboxHistoryUi() {
  bindFilters();
  window.addEventListener('hashchange', () => void syncKkboxHistory());
  window.addEventListener('popstate', () => void syncKkboxHistory());
  void syncKkboxHistory();
}
