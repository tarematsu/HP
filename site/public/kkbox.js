import {
  appendEmptyTableRow,
  byId,
  integerFormat,
  setNotice,
  setText,
} from './dashboard-ui-common.js?v=20261001.1';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';
import { renderRankHistoryChart } from './dashboard-rank-chart.js?v=20261003.1';
import { ensureChartRangeControls, filterDatesByRange } from './dashboard-chart-range.js';
import {
  MUSIC_ARTIST_LABELS,
  MUSIC_SERVICE_CADENCE,
  SAKAMICHI_GROUP_COLORS,
  loadMusicServiceReadModel,
  musicDateTimeText,
  replaceMusicTableBody,
} from './music-service-runtime-common.js?v=20261004.2';

import {
  createRegionalFilters,
  regionalProviderDate as dateOnly,
  regionalProviderDateText as dateText,
  regionalRankChartOptions,
  renderRegionalServiceStatus,
} from './music-service-regional-ui.js';

const SERVICE = 'kkbox';
const BODY_ID = 'kkboxJapaneseHistoryBody';
const OUT_OF_CHART_RANK = 101;
const CHART_START_DATE = '2020-10-01';
const ARTIST_ORDER = Object.freeze(['sakurazaka46', 'nogizaka46', 'hinatazaka46']);

let activeRequest = 0;
let activeTerritory = 'tw';
let activePeriodType = 'weekly';
let activeChartType = 'newrelease';
let activeArtistFilter = 'all';
let activeRange = '1y';
let lastPayload = null;

function itemArtists(item) { return Array.isArray(item?.canonical_artists) ? item.canonical_artists.filter((artist) => ARTIST_ORDER.includes(artist)) : []; }
function artistText(item) { const artists = itemArtists(item); return artists.length ? artists.map((artist) => MUSIC_ARTIST_LABELS[artist] || artist).join(' / ') : '-'; }
function seriesSelected(item) { return item?.territory === activeTerritory && item?.period_type === activePeriodType && item?.chart_type === activeChartType; }
function artistVisible(item) { const artists = itemArtists(item); return artists.length > 0 && (activeArtistFilter === 'all' || artists.includes(activeArtistFilter)); }

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
  return filterDatesByRange([...dates].sort(), activeRange);
}

function rankSeries(history, dates) {
  const visibleArtists = activeArtistFilter === 'all' ? ARTIST_ORDER : ARTIST_ORDER.filter((artist) => artist === activeArtistFilter);
  const visibleDates = new Set(dates);
  return visibleArtists.map((canonicalArtist) => {
    const byDate = new Map();
    for (const item of history) {
      if (!seriesSelected(item) || !itemArtists(item).includes(canonicalArtist)) continue;
      const date = dateOnly(item?.period); const rank = Number(item?.rank);
      if (!date || !visibleDates.has(date) || !Number.isFinite(rank) || rank < 1) continue;
      const previous = byDate.get(date); if (previous == null || rank < previous) byDate.set(date, rank);
    }
    return { id: canonicalArtist, title: MUSIC_ARTIST_LABELS[canonicalArtist] || canonicalArtist, color: SAKAMICHI_GROUP_COLORS[canonicalArtist], points: dates.map((date) => ({ date, rank: byDate.get(date) ?? OUT_OF_CHART_RANK })) };
  }).filter((series) => series.points.length);
}

function renderChart(chart) {
  const history = Array.isArray(chart?.history) ? chart.history : [];
  const dates = selectedPeriods(chart, history); const series = rankSeries(history, dates); const container = byId('kkboxJapaneseRankChart');
  ensureChartRangeControls(container, { owner: 'kkbox-japanese-rank', value: activeRange, onChange: (value) => { if (value === activeRange) return; activeRange = value; if (lastPayload) render(lastPayload); } });
  renderRankHistoryChart({
    ...regionalRankChartOptions({
      containerId: 'kkboxJapaneseRankChart', legendId: 'kkboxJapaneseRankLegend',
      series, dates,
      ariaLabel: 'KKBOX 日語チャートにおける選択条件・選択グループの最高順位推移。表示期間内の取得済み更新日の圏外も含み、1位が上。',
      emptyText: 'KKBOX 日語チャートの順位履歴はまだありません。',
      dateLabel: dateText,
    }),
  });
}

function renderHistory(chart) {
  const body = replaceMusicTableBody(BODY_ID); if (!body) return;
  const history = Array.isArray(chart?.history) ? chart.history : [];
  const ordered = history.filter(seriesSelected).filter(artistVisible).sort((a, b) => String(b?.period || '').localeCompare(String(a?.period || '')) || Number(a?.rank || Infinity) - Number(b?.rank || Infinity) || String(a?.title || '').localeCompare(String(b?.title || '')));
  if (!ordered.length) { appendEmptyTableRow(body, 'KKBOX 日語チャートのランクイン履歴はありません。', 4); return; }
  for (const item of ordered) { const rank = Number(item?.rank); appendTableRow(body, [dateText(item?.period), artistText(item), Number.isFinite(rank) && rank > 0 ? `${integerFormat.format(rank)}位` : '-', item?.title || '-']); }
}

const regionalFilters = createRegionalFilters([
  { attribute: 'kkbox-series-filter', get: () => `${activeTerritory}:${activeChartType}`,
    set: (value) => {
      if (!['tw:newrelease', 'hk:newrelease', 'tw:song', 'hk:song'].includes(value)) return;
      [activeTerritory, activeChartType] = value.split(':');
    } },
  { attribute: 'kkbox-period-filter', get: () => activePeriodType,
    set: (value) => { activePeriodType = value; } },
  { attribute: 'kkbox-artist-filter', get: () => activeArtistFilter,
    set: (value) => { activeArtistFilter = value; } },
], () => { if (lastPayload) render(lastPayload); });
function syncFilterButtons() { regionalFilters.sync(); }
function bindFilters() { regionalFilters.bind(); }

function renderStatus(payload) {
  renderRegionalServiceStatus(payload, { service: SERVICE, noticeId: 'kkboxNotice', label: 'KKBOX' });
}
function render(payload) {
  lastPayload = payload; setText('kkboxUpdatedAt', musicDateTimeText(payload.updated_at)); setText('kkboxCadence', MUSIC_SERVICE_CADENCE[SERVICE] || '-'); renderStatus(payload); syncFilterButtons(); const chart = payload?.kkbox_japanese_chart || {}; renderChart(chart); renderHistory(chart);
}

export async function loadKkboxView() {
  const request = ++activeRequest; bindFilters(); setText('kkboxUpdatedAt', '-'); setText('kkboxCadence', MUSIC_SERVICE_CADENCE[SERVICE] || '-'); setNotice('kkboxNotice', 'KKBOXデータを読み込んでいます。');
  for (const target of ['kkboxJapaneseRankLegend', 'kkboxJapaneseRankChart', BODY_ID]) replaceMusicTableBody(target);
  try { const payload = await loadMusicServiceReadModel(SERVICE); if (request === activeRequest) render(payload); }
  catch { if (request !== activeRequest) return; setNotice('kkboxNotice', 'KKBOXデータを取得できませんでした。時間をおいて再度お試しください。', true); const body = replaceMusicTableBody(BODY_ID); if (body) appendEmptyTableRow(body, 'KKBOX履歴データを取得できませんでした。', 4); const chart = byId('kkboxJapaneseRankChart'); if (chart) chart.textContent = 'KKBOX順位履歴を取得できませんでした。'; }
}
