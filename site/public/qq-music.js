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
  MUSIC_ARTIST_ORDER,
  MUSIC_SERVICE_CADENCE,
  SAKAMICHI_GROUP_COLORS,
  loadMusicServiceReadModel,
  musicDateTimeText,
  replaceMusicTableBody,
} from './music-service-runtime-common.js?v=20261004.2';

const SERVICE = 'qq_music';
const ARTIST_ORDER = MUSIC_ARTIST_ORDER.slice(0, 3);
const OUT_OF_CHART_RANK = 101;
const CHART_START_DATE = '2020-10-01';
let requestId = 0;
let activeArtistFilter = 'all';
let activeRange = '1y';
let lastPayload = null;

function periodParts(value) { const match = String(value || '').match(/^(\d{4})_(\d{1,2})$/); return match ? { year: Number(match[1]), week: Number(match[2]) } : null; }
function comparePeriods(left, right) { const a = periodParts(left); const b = periodParts(right); if (!a || !b) return String(left || '').localeCompare(String(right || '')); return (a.year - b.year) || (a.week - b.week); }
function providerDate(value) { const text = String(value || '').trim(); return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : ''; }
function providerDateText(value) { const date = providerDate(value); return date ? date.replaceAll('-', '/') : '-'; }
function artistVisible(canonicalArtist) { return ARTIST_ORDER.includes(canonicalArtist) && (activeArtistFilter === 'all' || canonicalArtist === activeArtistFilter); }
function syncFilterButtons() { for (const button of document.querySelectorAll('[data-qq-artist-filter]')) { const active = button.dataset.qqArtistFilter === activeArtistFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active ? 'true' : 'false'); } }
function qqStoredPeriods(chart, history) {
  const byPeriod = new Map();
  for (const item of Array.isArray(chart?.periods) ? chart.periods : []) { const period = String(item?.period || ''); const date = providerDate(item?.published_at); if (!periodParts(period) || !date) continue; byPeriod.set(period, { period, date }); }
  if (!byPeriod.size) for (const item of history) { const period = String(item?.period || ''); const date = providerDate(item?.published_at); if (!periodParts(period) || !date || byPeriod.has(period)) continue; byPeriod.set(period, { period, date }); }
  return [...byPeriod.values()].sort((a, b) => comparePeriods(a.period, b.period));
}
function qqSeries(history, periods) {
  const visiblePeriods = new Set(periods.map((item) => item.period));
  return ARTIST_ORDER.filter(artistVisible).map((canonicalArtist) => {
    const byPeriod = new Map();
    for (const item of history) { if (item?.canonical_artist !== canonicalArtist) continue; const period = String(item?.period || ''); const rank = Number(item.rank); if (!visiblePeriods.has(period) || !Number.isFinite(rank) || rank < 1) continue; const previous = byPeriod.get(period); if (!previous || rank < previous.rank) byPeriod.set(period, { rank }); }
    return { id: canonicalArtist, title: MUSIC_ARTIST_LABELS[canonicalArtist] || canonicalArtist, color: SAKAMICHI_GROUP_COLORS[canonicalArtist], points: periods.map(({ period, date }) => ({ date, rank: byPeriod.get(period)?.rank ?? OUT_OF_CHART_RANK })) };
  }).filter((series) => series.points.length);
}
function renderHistory(history, bodyId, emptyText) {
  const body = replaceMusicTableBody(bodyId); if (!body) return;
  const ordered = history.filter((item) => artistVisible(item?.canonical_artist)).sort((a, b) => comparePeriods(b.period, a.period) || Number(a.rank) - Number(b.rank) || String(a.title || '').localeCompare(String(b.title || '')));
  if (!ordered.length) { appendEmptyTableRow(body, emptyText, 4); return; }
  for (const item of ordered) appendTableRow(body, [providerDateText(item.published_at), MUSIC_ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-', Number.isFinite(Number(item.rank)) ? `${integerFormat.format(Number(item.rank))}位` : '-', item.title || '-']);
}
function renderRankChart(chart, { chartId, legendId, label }) {
  const history = Array.isArray(chart?.history) ? chart.history : []; const allPeriods = qqStoredPeriods(chart, history).filter(({ date }) => date >= CHART_START_DATE); const visibleDates = new Set(filterDatesByRange(allPeriods.map((item) => item.date), activeRange)); const periods = allPeriods.filter((item) => visibleDates.has(item.date)); const series = qqSeries(history, periods); const container = byId(chartId);
  ensureChartRangeControls(container, { owner: chartId, value: activeRange, onChange: (value) => { if (value === activeRange) return; activeRange = value; if (lastPayload) render(lastPayload); } });
  renderRankHistoryChart({ container, series, dates: periods.map((item) => item.date), height: 320, margin: { left: 58, right: 18, top: 12, bottom: 34 }, yMax: OUT_OF_CHART_RANK, rankTicks: [1, 25, 50, 75, OUT_OF_CHART_RANK], dateTickCount: 5, ariaLabel: `QQ Music ${label}における選択グループの更新日別最高順位推移。表示期間内の保存済み更新日の圏外も含み、1位が上。`, lineClass: 'kugou-rank-line', emptyClass: 'music-service-rank-empty', emptyText: `QQ Music ${label}の順位履歴はまだありません。`, rankLabel: (rank) => rank === OUT_OF_CHART_RANK ? '圏外' : `${rank}位`, dateLabel: providerDateText, latestPoint: { radius: () => 2.5 }, legendContainer: byId(legendId) });
  return history;
}
function renderPopularity(payload) {
  const body = replaceMusicTableBody('qqArtistPopularityBody'); if (!body) return;
  const trackById = new Map((Array.isArray(payload?.tracks) ? payload.tracks : []).filter((item) => item?.service === SERVICE).map((item) => [String(item.service_track_id || ''), item]));
  const rows = (Array.isArray(payload?.artist_track_orders) ? payload.artist_track_orders : []).filter((item) => item?.service === SERVICE).filter((item) => ARTIST_ORDER.includes(item?.canonical_artist)).filter((item) => artistVisible(item?.canonical_artist)).filter((item) => Number.isFinite(Number(item?.position)) && Number(item.position) > 0).sort((a, b) => ARTIST_ORDER.indexOf(a.canonical_artist) - ARTIST_ORDER.indexOf(b.canonical_artist) || Number(a.position) - Number(b.position) || String(trackById.get(String(a.service_track_id || ''))?.title || '').localeCompare(String(trackById.get(String(b.service_track_id || ''))?.title || '')));
  if (!rows.length) { appendEmptyTableRow(body, 'QQ Music のアーティスト別人気曲順位はありません。', 3); return; }
  for (const item of rows) { const track = trackById.get(String(item.service_track_id || '')); appendTableRow(body, [MUSIC_ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-', `${integerFormat.format(Number(item.position))}位`, track?.title || item.service_track_id || '-']); }
}
function renderStatus(payload) {
  const state = (payload.services || []).find((item) => item.service === SERVICE) || null;
  if (state?.status === 'error') setNotice('qqMusicNotice', 'QQ音乐の収集でエラーが発生しています。直前までの正常データを表示しています。', true);
  else if (state?.status === 'degraded') setNotice('qqMusicNotice', 'QQ音乐の一部項目の取得に失敗しています。取得できたデータのみ表示しています。');
  else setNotice('qqMusicNotice');
}
function render(payload) {
  lastPayload = payload; syncFilterButtons(); setText('qqMusicUpdatedAt', musicDateTimeText(payload.updated_at)); setText('qqMusicCadence', MUSIC_SERVICE_CADENCE[SERVICE] || '-'); renderStatus(payload);
  const japanHistory = renderRankChart(payload?.qq_japan_chart || {}, { chartId: 'qqJapanRankChart', legendId: 'qqJapanRankLegend', label: '日本榜' }); renderHistory(japanHistory, 'qqJapanHistoryBody', 'QQ Music 日本榜のランクイン履歴はありません。');
  const animeHistory = renderRankChart(payload?.qq_anime_chart || {}, { chartId: 'qqAnimeRankChart', legendId: 'qqAnimeRankLegend', label: '动漫音乐榜' }); renderHistory(animeHistory, 'qqAnimeHistoryBody', 'QQ Music 动漫音乐榜のランクイン履歴はありません。'); renderPopularity(payload);
}
function bindFilters() {
  for (const button of document.querySelectorAll('[data-qq-artist-filter]')) {
    if (button.dataset.qqFilterBound === '1') continue; button.dataset.qqFilterBound = '1';
    button.addEventListener('click', () => { const next = button.dataset.qqArtistFilter || 'all'; if (next === activeArtistFilter) return; activeArtistFilter = next; if (lastPayload) render(lastPayload); else syncFilterButtons(); });
  }
}
export async function loadQqMusicView() {
  const id = ++requestId; bindFilters(); setText('qqMusicUpdatedAt', '-'); setText('qqMusicCadence', MUSIC_SERVICE_CADENCE[SERVICE] || '-'); setNotice('qqMusicNotice', 'QQ音乐データを読み込んでいます。');
  for (const target of ['qqJapanRankLegend', 'qqJapanRankChart', 'qqJapanHistoryBody', 'qqAnimeRankLegend', 'qqAnimeRankChart', 'qqAnimeHistoryBody', 'qqArtistPopularityBody']) replaceMusicTableBody(target);
  try { const payload = await loadMusicServiceReadModel(SERVICE); if (id === requestId) render(payload); }
  catch { if (id !== requestId) return; setNotice('qqMusicNotice', 'QQ音乐データを取得できませんでした。時間をおいて再度お試しください。', true); const japanBody = replaceMusicTableBody('qqJapanHistoryBody'); if (japanBody) appendEmptyTableRow(japanBody, 'QQ Music 日本榜の履歴を取得できませんでした。', 4); const animeBody = replaceMusicTableBody('qqAnimeHistoryBody'); if (animeBody) appendEmptyTableRow(animeBody, 'QQ Music 动漫音乐榜の履歴を取得できませんでした。', 4); const popularityBody = replaceMusicTableBody('qqArtistPopularityBody'); if (popularityBody) appendEmptyTableRow(popularityBody, 'QQ Music の人気曲順位を取得できませんでした。', 3); }
}
