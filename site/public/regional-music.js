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
  REGIONAL_MUSIC_CADENCE,
  SAKAMICHI_GROUP_COLORS,
  loadRegionalMusicReadModel,
  musicDateTimeText,
  musicValueText,
  replaceMusicTableBody,
} from './music-service-runtime-common.js?v=20261004.1';

const SUPPORTED_SERVICES = new Set(['kkbox', 'qq_music', 'kugou_music']);
const OUT_OF_CHART_RANK = 101;
const CHART_START_DATE = '2021-01-01';

let activeRequest = 0;
let kugouArtistFilter = 'all';
let lastKugouPayload = null;

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

function artistPosition(artist) {
  const index = MUSIC_ARTIST_ORDER.indexOf(artist);
  return index < 0 ? MUSIC_ARTIST_ORDER.length : index;
}

function renderArtists(rows) {
  const body = replaceMusicTableBody('regionalMusicArtistBody');
  if (!body) return;
  if (!rows.length) {
    appendEmptyTableRow(body, 'アーティストデータがありません。', 4);
    return;
  }
  for (const item of [...rows].sort((a,b) => artistPosition(a.canonical_artist)-artistPosition(b.canonical_artist))) {
    appendTableRow(body, [
      MUSIC_ARTIST_LABELS[item.canonical_artist] || item.display_name || item.canonical_artist || '-',
      musicValueText(item.followers),
      musicValueText(item.likes),
      item.service_artist_id || '-',
    ]);
  }
}

export function regionalTrackRows(rows, orders = []) {
  const byTrack = new Map();
  for (const order of orders) {
    const key = `${order.service}:${order.service_track_id}`;
    if (!byTrack.has(key)) byTrack.set(key, []);
    byTrack.get(key).push(order);
  }
  return rows.flatMap(item => {
    const positions = byTrack.get(`${item.service}:${item.service_track_id}`);
    return positions?.length ? positions.map(order => ({ ...item,
      canonical_artist: order.canonical_artist, popularity_rank: order.position, rank_source: order.rank_source,
    })) : [item];
  }).sort((a,b) => artistPosition(a.canonical_artist)-artistPosition(b.canonical_artist)
    || (a.popularity_rank ?? Infinity) - (b.popularity_rank ?? Infinity));
}

function renderTracks(rows, orders = []) {
  const body = replaceMusicTableBody('regionalMusicTrackBody');
  if (!body) return;
  if (!rows.length) {
    appendEmptyTableRow(body, '楽曲データがありません。', 7);
    return;
  }
  for (const item of regionalTrackRows(rows, orders)) {
    const rank = item.rank_source === 'artist_page_order'
      ? `${musicValueText(item.popularity_rank)}（掲載順・推定）`
      : musicValueText(item.popularity_rank);
    appendTableRow(body, [
      MUSIC_ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      item.title || item.service_track_id || '-',
      musicValueText(item.plays),
      musicValueText(item.listeners),
      musicValueText(item.likes),
      musicValueText(item.comments),
      rank,
    ]);
  }
}

function renderPlaylists(rows, memberships) {
  const body = replaceMusicTableBody('regionalMusicPlaylistBody');
  if (!body) return;
  if (!rows.length) {
    appendEmptyTableRow(body, 'プレイリストデータがありません。', 4);
    return;
  }
  const counts = new Map();
  for (const membership of memberships) {
    const key = String(membership.service_playlist_id || '');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const item of rows) {
    appendTableRow(body, [
      item.playlist_name || item.service_playlist_id || '-',
      item.playlist_type || '-',
      item.owner_name || '-',
      musicValueText(counts.get(String(item.service_playlist_id || '')) || 0),
    ]);
  }
}

function compactChartMode(service) {
  return service === 'qq_music' || service === 'kugou_music';
}

function setCompactChartMode(service) {
  const compact = compactChartMode(service);
  byId('regionalMusicView')?.classList.toggle('is-chart-compact', compact);
  const genericTables = byId('regionalMusicGenericTables');
  const compactMeta = byId('regionalMusicCompactMeta');
  if (genericTables) genericTables.hidden = compact;
  if (compactMeta) compactMeta.hidden = !compact;
  if (!compact) {
    const compactNotice = byId('regionalMusicCompactNotice');
    if (compactNotice) compactNotice.hidden = true;
  }
}

function setCompactNotice(message = '', error = false) {
  const wrapper = byId('regionalMusicCompactNotice');
  if (!wrapper) return;
  wrapper.hidden = !message;
  setNotice('regionalMusicCompactNoticeText', message || undefined, error);
}

function kugouArtistVisible(canonicalArtist) {
  return kugouArtistFilter === 'all' || canonicalArtist === kugouArtistFilter;
}

function syncKugouFilterButtons() {
  for (const button of document.querySelectorAll('[data-kugou-artist-filter]')) {
    const active = button.dataset.kugouArtistFilter === kugouArtistFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function bindKugouFilters() {
  for (const button of document.querySelectorAll('[data-kugou-artist-filter]')) {
    if (button.dataset.kugouFilterBound === '1') continue;
    button.dataset.kugouFilterBound = '1';
    button.addEventListener('click', () => {
      const next = button.dataset.kugouArtistFilter || 'all';
      if (next === kugouArtistFilter) return;
      kugouArtistFilter = next;
      if (lastKugouPayload && location.hash.slice(1) === 'kugou_music') renderKugouHistory(lastKugouPayload, 'kugou_music');
      else syncKugouFilterButtons();
    });
  }
}

function kugouSeries(history, coveredDates = []) {
  return MUSIC_ARTIST_ORDER.slice(0, 3).filter(kugouArtistVisible).map((canonicalArtist) => {
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
      points:coveredDates.length
        ? coveredDates.map((date) => ({ date, rank:byDate.get(date)?.rank ?? OUT_OF_CHART_RANK }))
        : [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }).filter((series) => series.points.length);
}

function renderKugouRankChart({ containerId, legendId, history, coveredDates, ariaLabel, emptyText }) {
  const chartHistory = history.filter((item) => providerDate(item?.published_at) >= CHART_START_DATE);
  const chartCoveredDates = coveredDates.filter((date) => date >= CHART_START_DATE);
  const series = kugouSeries(chartHistory, chartCoveredDates);
  const dates = chartCoveredDates.length
    ? chartCoveredDates
    : [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  renderRankHistoryChart({
    container:byId(containerId),
    series,
    dates,
    height:320,
    margin:{ left:58, right:18, top:12, bottom:34 },
    yMax:OUT_OF_CHART_RANK,
    rankTicks:[1, 25, 50, 75, OUT_OF_CHART_RANK],
    dateTickCount:5,
    ariaLabel,
    lineClass:'kugou-rank-line',
    emptyClass:'regional-music-rank-empty',
    emptyText,
    rankLabel:(rank) => rank === OUT_OF_CHART_RANK ? '圏外' : `${rank}位`,
    dateLabel:providerDateText,
    latestPoint:{ radius:() => 2.5 },
    legendContainer:byId(legendId),
  });
}

function renderKugouHistoryTable({ bodyId, history, emptyText }) {
  const body = replaceMusicTableBody(bodyId);
  if (!body) return;
  const ordered = history
    .filter((item) => kugouArtistVisible(item?.canonical_artist))
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

function renderKugouHistory(payload, service) {
  const visible = service === 'kugou_music';
  for (const id of ['kugouJapanChartSection','kugouJapanHistorySection','kugouAcgChartSection','kugouAcgHistorySection']) {
    const section = byId(id);
    if (section) section.hidden = !visible;
  }
  if (!visible) return;

  lastKugouPayload = payload;
  bindKugouFilters();
  syncKugouFilterButtons();

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
  renderKugouRankChart({
    containerId:'kugouJapanRankChart',
    legendId:'kugouJapanRankLegend',
    history:japanHistory,
    coveredDates:japanCoveredDates,
    ariaLabel:'Kugou Music 日本榜における選択グループの各日最高順位推移。取得済み平日の圏外も含み、1位が上。',
    emptyText:'Kugou Music 日本榜の順位履歴はまだありません。',
  });
  renderKugouHistoryTable({
    bodyId:'kugouJapanHistoryBody',
    history:japanHistory,
    emptyText:'Kugou Music 日本榜のランクイン履歴はありません。',
  });

  const acgChart = payload?.kugou_acg_chart || {};
  const acgHistory = Array.isArray(acgChart.history) ? acgChart.history : [];
  const acgCoveredDates = (Array.isArray(acgChart.periods) ? acgChart.periods : [])
    .map((item) => providerDate(item?.published_at))
    .filter(Boolean);
  renderKugouRankChart({
    containerId:'kugouAcgRankChart',
    legendId:'kugouAcgRankLegend',
    history:acgHistory,
    coveredDates:[...new Set(acgCoveredDates)].sort(),
    ariaLabel:'Kugou Music ACG新歌榜における選択グループの週次最高順位推移。取得済み週の圏外も含み、1位が上。',
    emptyText:'Kugou Music ACG新歌榜の順位履歴はまだありません。',
  });
  renderKugouHistoryTable({
    bodyId:'kugouAcgHistoryBody',
    history:acgHistory,
    emptyText:'Kugou Music ACG新歌榜のランクイン履歴はありません。',
  });
}

function renderService(payload, service) {
  const state = (payload.services || []).find((item) => item.service === service) || null;
  const artists = (payload.artists || []).filter((item) => item.service === service);
  const tracks = (payload.tracks || []).filter((item) => item.service === service);
  const playlists = (payload.playlists || []).filter((item) => item.service === service);
  const memberships = (payload.playlist_memberships || []).filter((item) => item.service === service);
  const compact = compactChartMode(service);

  setCompactChartMode(service);
  setText('regionalMusicChartUpdated', musicDateTimeText(payload.updated_at));
  setText('regionalMusicChartCadence', REGIONAL_MUSIC_CADENCE[service] || '-');

  if (compact) {
    setNotice('regionalMusicNotice');
    if (state?.status === 'error') setCompactNotice('収集エラーが発生しています。直前までの正常データを表示しています。', true);
    else if (state?.status === 'degraded') setCompactNotice('一部項目の取得に失敗しています。取得できたデータのみ表示しています。');
    else setCompactNotice();
    renderKugouHistory(payload, service);
    return;
  }

  if (state?.status === 'error') {
    setNotice('regionalMusicNotice', '収集エラーが発生しています。直前までの正常データは保持されています。', true);
  } else if (state?.status === 'pending') {
    setNotice('regionalMusicNotice', 'このサービスは現在待機中です。公開取得可能なデータだけ表示します。');
  } else if (state?.status === 'degraded') {
    setNotice('regionalMusicNotice', '一部項目の取得に失敗しています。取得できたデータのみ表示します。');
  } else {
    setNotice('regionalMusicNotice');
  }

  renderKugouHistory(payload, service);
  renderArtists(artists);
  renderTracks(tracks, payload.artist_track_orders);
  renderPlaylists(playlists, memberships);
}

function resetKugouSections() {
  for (const id of ['kugouJapanChartSection','kugouJapanHistorySection','kugouAcgChartSection','kugouAcgHistorySection']) {
    const section = byId(id);
    if (section) section.hidden = true;
  }
  for (const id of [
    'kugouJapanRankLegend','kugouJapanRankChart','kugouJapanHistoryBody',
    'kugouAcgRankLegend','kugouAcgRankChart','kugouAcgHistoryBody',
  ]) replaceMusicTableBody(id);
}

export async function loadRegionalMusicView(service) {
  const request = ++activeRequest;
  const serviceId = String(service || location.hash.slice(1) || '');
  if (!SUPPORTED_SERVICES.has(serviceId)) throw new Error(`unknown regional music service: ${serviceId}`);
  setCompactChartMode(serviceId);
  setText('regionalMusicChartUpdated', '-');
  setText('regionalMusicChartCadence', REGIONAL_MUSIC_CADENCE[serviceId] || '-');
  for (const id of ['regionalMusicArtistBody', 'regionalMusicTrackBody', 'regionalMusicPlaylistBody']) replaceMusicTableBody(id);
  resetKugouSections();
  setCompactNotice();
  if (!compactChartMode(serviceId)) setNotice('regionalMusicNotice', 'データを読み込んでいます。');
  try {
    const payload = await loadRegionalMusicReadModel(serviceId);
    if (request === activeRequest) renderService(payload, serviceId);
  } catch {
    if (request !== activeRequest) return;
    if (compactChartMode(serviceId)) {
      setCompactNotice('データを取得できませんでした。時間をおいて再度お試しください。', true);
      return;
    }
    setNotice('regionalMusicNotice', 'データを取得できませんでした。時間をおいて再度お試しください。', true);
    appendEmptyTableRow(byId('regionalMusicArtistBody'), 'データ未取得', 4);
    appendEmptyTableRow(byId('regionalMusicTrackBody'), 'データ未取得', 7);
    appendEmptyTableRow(byId('regionalMusicPlaylistBody'), 'データ未取得', 4);
  }
}
