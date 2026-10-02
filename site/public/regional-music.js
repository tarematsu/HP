import {
  appendEmptyTableRow,
  byId,
  integerFormat,
  setNotice,
  setText,
} from './dashboard-ui-common.js?v=20261001.1';
import { renderRankHistoryChart } from './dashboard-rank-chart.js?v=20261002.1';

const SERVICE_LABELS = Object.freeze({
  genie: 'Genie',
  bugs: 'Bugs!',
  joox: 'JOOX',
  nhaccuatui: 'NhacCuaTui',
  anghami: 'Anghami',
  melon: 'Melon',
  qq_music: 'QQ Music',
  netease_cloud_music: 'NetEase Cloud Music',
  kugou_music: 'Kugou Music',
  naver_vibe: 'Naver VIBE',
  flo: 'FLO',
  yandex_music: 'Yandex Music',
  boomplay: 'Boomplay',
  plern: 'Plern',
  fungjai: 'Fungjai',
  zing_mp3: 'Zing MP3',
  jiosaavn: 'JioSaavn',
  gaana: 'Gaana',
  langit_musik: 'Langit Musik',
});

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

const STATUS_LABELS = Object.freeze({
  ok: '正常',
  degraded: '一部取得',
  pending: '待機',
  error: 'エラー',
});

const COMPACT_CHART_CADENCE = Object.freeze({
  melon: '毎週月曜日 00:00',
  qq_music: '毎日 00:00 JST',
  kugou_music: '平日11:30 / ACG新歌榜: 水曜11:40',
});

const OUT_OF_CHART_RANK = 101;

const readModelPromises = new Map();
let activeRequest = 0;
let melonArtistFilter = 'all';
let lastMelonPayload = null;
let kugouArtistFilter = 'all';
let lastKugouPayload = null;

function valueText(value) {
  if (value === null || value === undefined || value === '') return '-';
  const number = Number(value);
  return Number.isFinite(number) ? integerFormat.format(number) : String(value);
}

function dateTimeText(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '-';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp));
}

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

function replaceBody(id) {
  const body = byId(id);
  if (body) body.replaceChildren();
  return body;
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

async function loadReadModel(service) {
  const serviceId = String(service || '').trim();
  if (!readModelPromises.has(serviceId)) {
    const request = fetch(`/api/regional-music?service=${encodeURIComponent(serviceId)}`, {
      headers: { accept: 'application/json' },
      cache: 'default',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`regional music ${serviceId} HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok || payload.service !== serviceId) {
        throw new Error(payload?.error || `regional music ${serviceId} read model unavailable`);
      }
      return payload;
    }).catch((error) => {
      readModelPromises.delete(serviceId);
      throw error;
    });
    readModelPromises.set(serviceId, request);
  }
  return readModelPromises.get(serviceId);
}

const ARTIST_DISPLAY_ORDER = ['sakurazaka46','nogizaka46','hinatazaka46','aobazaka46'];
function artistPosition(artist) {
  const index = ARTIST_DISPLAY_ORDER.indexOf(artist);
  return index < 0 ? ARTIST_DISPLAY_ORDER.length : index;
}

function renderArtists(rows) {
  const body = replaceBody('regionalMusicArtistBody');
  if (!body) return;
  if (!rows.length) {
    appendEmptyTableRow(body, 'アーティストデータがありません。', 4);
    return;
  }
  for (const item of [...rows].sort((a,b) => artistPosition(a.canonical_artist)-artistPosition(b.canonical_artist))) {
    body.append(row([
      ARTIST_LABELS[item.canonical_artist] || item.display_name || item.canonical_artist || '-',
      valueText(item.followers),
      valueText(item.likes),
      item.service_artist_id || '-',
    ]));
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
  const body = replaceBody('regionalMusicTrackBody');
  if (!body) return;
  if (!rows.length) {
    appendEmptyTableRow(body, '楽曲データがありません。', 7);
    return;
  }
  for (const item of regionalTrackRows(rows, orders)) {
    const rank = item.rank_source === 'artist_page_order' ? `${valueText(item.popularity_rank)}（掲載順・推定）` : valueText(item.popularity_rank);
    body.append(row([
      ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      item.title || item.service_track_id || '-',
      valueText(item.plays),
      valueText(item.listeners),
      valueText(item.likes),
      valueText(item.comments),
      rank,
    ]));
  }
}

function renderPlaylists(rows, memberships) {
  const body = replaceBody('regionalMusicPlaylistBody');
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
    body.append(row([
      item.playlist_name || item.service_playlist_id || '-',
      item.playlist_type || '-',
      item.owner_name || '-',
      valueText(counts.get(String(item.service_playlist_id || '')) || 0),
    ]));
  }
}

function renderHealth(state) {
  const mount = byId('regionalMusicHealth');
  if (!mount) return;
  mount.replaceChildren();
  const entries = [
    ['状態', STATUS_LABELS[state?.status] || state?.status || '未取得'],
    ['最終試行', dateTimeText(state?.last_attempt_at)],
    ['最終成功', dateTimeText(state?.last_success_at)],
    ['取得項目', Array.isArray(state?.metrics) && state.metrics.length ? state.metrics.join(', ') : '-'],
    ['エラー種別', state?.last_error_class || '-'],
    ['エラー内容', state?.last_error_message || '-'],
  ];
  for (const [label, value] of entries) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    mount.append(dt, dd);
  }
}

function compactChartMode(service) {
  return service === 'melon' || service === 'qq_music' || service === 'kugou_music';
}

function setCompactChartMode(service) {
  const compact = compactChartMode(service);
  const view = byId('regionalMusicView');
  view?.classList.toggle('is-chart-compact', compact);
  const genericHeader = byId('regionalMusicGenericHeader');
  const genericTables = byId('regionalMusicGenericTables');
  const compactMeta = byId('regionalMusicCompactMeta');
  if (genericHeader) genericHeader.hidden = compact;
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

function melonArtistVisible(canonicalArtist) {
  return melonArtistFilter === 'all' || canonicalArtist === melonArtistFilter;
}

function syncMelonFilterButtons() {
  for (const button of document.querySelectorAll('[data-melon-artist-filter]')) {
    const active = button.dataset.melonArtistFilter === melonArtistFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
}

function bindMelonFilters() {
  for (const button of document.querySelectorAll('[data-melon-artist-filter]')) {
    if (button.dataset.melonFilterBound === '1') continue;
    button.dataset.melonFilterBound = '1';
    button.addEventListener('click', () => {
      const next = button.dataset.melonArtistFilter || 'all';
      if (next === melonArtistFilter) return;
      melonArtistFilter = next;
      if (lastMelonPayload && location.hash.slice(1) === 'melon') renderMelonPopularity(lastMelonPayload, 'melon');
      else syncMelonFilterButtons();
    });
  }
}

function renderMelonPopularity(payload, service) {
  const section = byId('melonArtistPopularitySection');
  const visible = service === 'melon';
  if (section) section.hidden = !visible;
  if (!visible) return;

  lastMelonPayload = payload;
  bindMelonFilters();
  syncMelonFilterButtons();
  const trackById = new Map((Array.isArray(payload?.tracks) ? payload.tracks : [])
    .filter((item) => item?.service === 'melon')
    .map((item) => [String(item.service_track_id || ''), item]));
  const rows = (Array.isArray(payload?.artist_track_orders) ? payload.artist_track_orders : [])
    .filter((item) => item?.service === 'melon')
    .filter((item) => item?.rank_source === 'provider_popularity_order')
    .filter((item) => ARTIST_DISPLAY_ORDER.slice(0, 3).includes(item?.canonical_artist))
    .filter((item) => melonArtistVisible(item?.canonical_artist))
    .filter((item) => Number.isFinite(Number(item?.position)) && Number(item.position) > 0)
    .sort((a, b) => artistPosition(a.canonical_artist) - artistPosition(b.canonical_artist)
      || Number(a.position) - Number(b.position)
      || String(trackById.get(String(a.service_track_id || ''))?.title || '').localeCompare(String(trackById.get(String(b.service_track_id || ''))?.title || '')));
  const body = replaceBody('melonArtistPopularityBody');
  if (!body) return;
  if (!rows.length) {
    appendEmptyTableRow(body, 'Melon のアーティスト別人気曲順位はありません。', 3);
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
  return ARTIST_DISPLAY_ORDER.slice(0, 3).filter(kugouArtistVisible).map((canonicalArtist) => {
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
      title: ARTIST_LABELS[canonicalArtist] || canonicalArtist,
      color:GROUP_COLORS[canonicalArtist],
      points:coveredDates.length
        ? coveredDates.map((date) => ({ date, rank:byDate.get(date)?.rank ?? OUT_OF_CHART_RANK }))
        : [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }).filter((series) => series.points.length);
}

function renderKugouRankChart({ containerId, legendId, history, coveredDates, ariaLabel, emptyText }) {
  const series = kugouSeries(history, coveredDates);
  const dates = coveredDates.length
    ? coveredDates
    : [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  renderRankHistoryChart({
    container:byId(containerId),
    series,
    dates,
    height:320,
    margin:{ left:58, right:18, top:12, bottom:34 },
    yMax:OUT_OF_CHART_RANK,
    rankTicks:[1, 25, 50, 75, 100, OUT_OF_CHART_RANK],
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
  const body = replaceBody(bodyId);
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
    body.append(row([
      providerDateText(item.published_at),
      ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      Number.isFinite(rank) ? (rank >= OUT_OF_CHART_RANK ? '圏外' : `${integerFormat.format(rank)}位`) : '-',
      item.title || '-',
    ]));
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
  setText('regionalMusicTitle', SERVICE_LABELS[service] || service);
  setText('regionalMusicRegion', state?.region || '');
  // The top timestamp is the selected service read-model generation time.
  setText('regionalMusicUpdated', dateTimeText(payload.updated_at));
  setText('regionalMusicChartUpdated', dateTimeText(payload.updated_at));
  setText('regionalMusicChartCadence', COMPACT_CHART_CADENCE[service] || '-');
  setText('regionalMusicStatus', STATUS_LABELS[state?.status] || state?.status || '未取得');
  setText('regionalMusicArtistCount', integerFormat.format(artists.length));
  setText('regionalMusicTrackCount', integerFormat.format(tracks.length));
  setText('regionalMusicPlaylistCount', integerFormat.format(playlists.length));

  if (compact) {
    if (state?.status === 'error') setCompactNotice('収集エラーが発生しています。直前までの正常データを表示しています。', true);
    else if (state?.status === 'degraded') setCompactNotice('一部項目の取得に失敗しています。取得できたデータのみ表示しています。');
    else setCompactNotice();
    renderMelonPopularity(payload, service);
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

  renderHealth(state);
  renderMelonPopularity(payload, service);
  renderKugouHistory(payload, service);
  renderArtists(artists);
  renderTracks(tracks, payload.artist_track_orders);
  renderPlaylists(playlists, memberships);
}

function resetMelonSection() {
  const section = byId('melonArtistPopularitySection');
  if (section) section.hidden = true;
  replaceBody('melonArtistPopularityBody');
}

function resetKugouSections() {
  for (const id of ['kugouJapanChartSection','kugouJapanHistorySection','kugouAcgChartSection','kugouAcgHistorySection']) {
    const section = byId(id);
    if (section) section.hidden = true;
  }
  for (const id of [
    'kugouJapanRankLegend','kugouJapanRankChart','kugouJapanHistoryBody',
    'kugouAcgRankLegend','kugouAcgRankChart','kugouAcgHistoryBody',
  ]) replaceBody(id);
}

export async function loadRegionalMusicView(service) {
  const request = ++activeRequest;
  const serviceId = String(service || location.hash.slice(1) || '');
  if (!SERVICE_LABELS[serviceId]) throw new Error(`unknown regional music service: ${serviceId}`);
  setCompactChartMode(serviceId);
  setText('regionalMusicTitle', SERVICE_LABELS[serviceId]);
  for (const id of ['regionalMusicUpdated', 'regionalMusicChartUpdated', 'regionalMusicStatus', 'regionalMusicArtistCount', 'regionalMusicTrackCount', 'regionalMusicPlaylistCount']) setText(id, '-');
  setText('regionalMusicChartCadence', COMPACT_CHART_CADENCE[serviceId] || '-');
  setText('regionalMusicRegion', '');
  for (const id of ['regionalMusicHealth', 'regionalMusicArtistBody', 'regionalMusicTrackBody', 'regionalMusicPlaylistBody']) replaceBody(id);
  resetMelonSection();
  resetKugouSections();
  setCompactNotice();
  if (!compactChartMode(serviceId)) setNotice('regionalMusicNotice', 'データを読み込んでいます。');
  try {
    const payload = await loadReadModel(serviceId);
    if (request === activeRequest) renderService(payload, serviceId);
  } catch (error) {
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
