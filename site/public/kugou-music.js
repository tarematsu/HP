import {
  appendEmptyTableRow,
  byId,
  integerFormat,
  setNotice,
  setText,
} from './dashboard-ui-common.js?v=20261001.1';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';
import { renderRankHistoryChart } from './dashboard-rank-chart.js?v=20261003.1';
import {
  MUSIC_ARTIST_LABELS,
  MUSIC_ARTIST_ORDER,
  MUSIC_SERVICE_CADENCE,
  SAKAMICHI_GROUP_COLORS,
  loadMusicServiceReadModel,
  musicDateTimeText,
  replaceMusicTableBody,
} from './music-service-runtime-common.js?v=20261004.2';

const SERVICE = 'kugou_music';
const OUT_OF_CHART_RANK = 101;
const CHART_START_DATE = '2020-10-01';
const ARTIST_ORDER = MUSIC_ARTIST_ORDER.slice(0, 3);

let activeRequest = 0;
let artistFilter = 'all';
let lastPayload = null;

function providerDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function providerDateText(value) {
  const date = providerDate(value);
  return date ? date.replaceAll('-', '/') : String(value || '-');
}

function providerWeekdays(startValue, endValue) {
  const start = providerDate(startValue);
  const end = providerDate(endValue);
  if (!start || !end || start > end) return [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  const dates = [];
  while (cursor <= last) {
    const weekday = cursor.getUTCDay();
    if (weekday >= 1 && weekday <= 5) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function artistVisible(canonicalArtist) {
  return ARTIST_ORDER.includes(canonicalArtist)
    && (artistFilter === 'all' || canonicalArtist === artistFilter);
}

function syncFilterButtons() {
  for (const button of document.querySelectorAll('[data-kugou-artist-filter]')) {
    const active = button.dataset.kugouArtistFilter === artistFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function bindFilters() {
  for (const button of document.querySelectorAll('[data-kugou-artist-filter]')) {
    if (button.dataset.kugouFilterBound === '1') continue;
    button.dataset.kugouFilterBound = '1';
    button.addEventListener('click', () => {
      const next = button.dataset.kugouArtistFilter || 'all';
      if (next === artistFilter) return;
      artistFilter = next;
      if (lastPayload) render(lastPayload);
      else syncFilterButtons();
    });
  }
}

function rankSeries(history, coveredDates = []) {
  return ARTIST_ORDER.filter(artistVisible).map((canonicalArtist) => {
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
      id: canonicalArtist,
      title: MUSIC_ARTIST_LABELS[canonicalArtist] || canonicalArtist,
      color: SAKAMICHI_GROUP_COLORS[canonicalArtist],
      points: coveredDates.length
        ? coveredDates.map((date) => ({ date, rank: byDate.get(date)?.rank ?? OUT_OF_CHART_RANK }))
        : [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }).filter((series) => series.points.length);
}

function renderRankChart({ containerId, legendId, history, coveredDates, ariaLabel, emptyText }) {
  const chartHistory = history.filter((item) => providerDate(item?.published_at) >= CHART_START_DATE);
  const chartCoveredDates = coveredDates.filter((date) => date >= CHART_START_DATE);
  const series = rankSeries(chartHistory, chartCoveredDates);
  const dates = chartCoveredDates.length
    ? chartCoveredDates
    : [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  renderRankHistoryChart({
    container: byId(containerId),
    series,
    dates,
    height: 320,
    margin: { left: 58, right: 18, top: 12, bottom: 34 },
    yMax: OUT_OF_CHART_RANK,
    rankTicks: [1, 25, 50, 75, OUT_OF_CHART_RANK],
    dateTickCount: 5,
    ariaLabel,
    lineClass: 'kugou-rank-line',
    emptyClass: 'music-service-rank-empty',
    emptyText,
    rankLabel: (rank) => rank === OUT_OF_CHART_RANK ? '圏外' : `${rank}位`,
    dateLabel: providerDateText,
    latestPoint: { radius: () => 2.5 },
    legendContainer: byId(legendId),
  });
}

function renderHistoryTable({ bodyId, history, emptyText }) {
  const body = replaceMusicTableBody(bodyId);
  if (!body) return;
  const ordered = history
    .filter((item) => artistVisible(item?.canonical_artist))
    .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')) || Number(a.rank) - Number(b.rank));
  if (!ordered.length) {
    appendEmptyTableRow(body, emptyText, 4);
    return;
  }
  for (const item of ordered) {
    const rank = Number(item.rank);
    appendTableRow(body, [
      providerDateText(item.published_at),
      MUSIC_ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      Number.isFinite(rank) ? (rank >= OUT_OF_CHART_RANK ? '圏外' : `${integerFormat.format(rank)}位`) : '-',
      item.title || '-',
    ]);
  }
}

function renderStatus(payload) {
  const state = (payload.services || []).find((item) => item.service === SERVICE) || null;
  if (state?.status === 'error') {
    setNotice('kugouMusicNotice', '酷狗音乐の収集でエラーが発生しています。直前までの正常データを表示しています。', true);
  } else if (state?.status === 'degraded') {
    setNotice('kugouMusicNotice', '酷狗音乐の一部項目の取得に失敗しています。取得できたデータのみ表示しています。');
  } else {
    setNotice('kugouMusicNotice');
  }
}

function render(payload) {
  lastPayload = payload;
  bindFilters();
  syncFilterButtons();
  setText('kugouMusicUpdatedAt', musicDateTimeText(payload.updated_at));
  setText('kugouMusicCadence', MUSIC_SERVICE_CADENCE[SERVICE] || '-');
  renderStatus(payload);

  const japanChart = payload?.kugou_japan_chart || {};
  const japanHistory = Array.isArray(japanChart.history) ? japanChart.history : [];
  const japanCoverage = japanChart.coverage || {};
  const legacyCoveredDates = Array.isArray(japanCoverage.legacy_covered_dates)
    ? japanCoverage.legacy_covered_dates.map(providerDate).filter(Boolean)
    : [];
  const currentCoveredDates = providerWeekdays(
    japanCoverage.current_api_oldest_available || japanCoverage.oldest_available,
    japanCoverage.latest_checked || japanCoverage.latest_available,
  );
  const japanCoveredDates = [...new Set([...legacyCoveredDates, ...currentCoveredDates])].sort();
  renderRankChart({
    containerId: 'kugouJapanRankChart',
    legendId: 'kugouJapanRankLegend',
    history: japanHistory,
    coveredDates: japanCoveredDates,
    ariaLabel: 'Kugou Music 日本榜における選択グループの各日最高順位推移。取得済み平日の圏外も含み、1位が上。',
    emptyText: 'Kugou Music 日本榜の順位履歴はまだありません。',
  });
  renderHistoryTable({
    bodyId: 'kugouJapanHistoryBody',
    history: japanHistory,
    emptyText: 'Kugou Music 日本榜のランクイン履歴はありません。',
  });

  const acgChart = payload?.kugou_acg_chart || {};
  const acgHistory = Array.isArray(acgChart.history) ? acgChart.history : [];
  const acgCoveredDates = (Array.isArray(acgChart.periods) ? acgChart.periods : [])
    .map((item) => providerDate(item?.published_at))
    .filter(Boolean);
  renderRankChart({
    containerId: 'kugouAcgRankChart',
    legendId: 'kugouAcgRankLegend',
    history: acgHistory,
    coveredDates: [...new Set(acgCoveredDates)].sort(),
    ariaLabel: 'Kugou Music ACG新歌榜における選択グループの週次最高順位推移。取得済み週の圏外も含み、1位が上。',
    emptyText: 'Kugou Music ACG新歌榜の順位履歴はまだありません。',
  });
  renderHistoryTable({
    bodyId: 'kugouAcgHistoryBody',
    history: acgHistory,
    emptyText: 'Kugou Music ACG新歌榜のランクイン履歴はありません。',
  });
}

export async function loadKugouMusicView() {
  const request = ++activeRequest;
  bindFilters();
  setText('kugouMusicUpdatedAt', '-');
  setText('kugouMusicCadence', MUSIC_SERVICE_CADENCE[SERVICE] || '-');
  setNotice('kugouMusicNotice', '酷狗音乐データを読み込んでいます。');
  for (const target of [
    'kugouJapanRankLegend', 'kugouJapanRankChart', 'kugouJapanHistoryBody',
    'kugouAcgRankLegend', 'kugouAcgRankChart', 'kugouAcgHistoryBody',
  ]) replaceMusicTableBody(target);
  try {
    const payload = await loadMusicServiceReadModel(SERVICE);
    if (request === activeRequest) render(payload);
  } catch {
    if (request !== activeRequest) return;
    setNotice('kugouMusicNotice', '酷狗音乐データを取得できませんでした。時間をおいて再度お試しください。', true);
    for (const [bodyId, message] of [
      ['kugouJapanHistoryBody', 'Kugou Music 日本榜のランクイン履歴を取得できませんでした。'],
      ['kugouAcgHistoryBody', 'Kugou Music ACG新歌榜のランクイン履歴を取得できませんでした。'],
    ]) {
      const body = replaceMusicTableBody(bodyId);
      if (body) appendEmptyTableRow(body, message, 4);
    }
  }
}