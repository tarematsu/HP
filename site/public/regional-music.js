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

let readModelPromise = null;
let activeRequest = 0;

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

function providerDateTimeText(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?/);
  if (!match) return '-';
  return `${match[1]}/${match[2]}/${match[3]}${match[4] ? ` ${match[4]}:${match[5]}:${match[6]}` : ''}`;
}

function providerShortDate(value) {
  const date = providerDate(value);
  return date ? `${date.slice(5, 7)}/${date.slice(8, 10)}` : String(value || '');
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

async function loadReadModel() {
  if (!readModelPromise) {
    readModelPromise = fetch('/api/regional-music', {
      headers: { accept: 'application/json' },
      cache: 'default',
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

function kugouSeries(history) {
  return ARTIST_DISPLAY_ORDER.slice(0, 3).map((canonicalArtist) => {
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
      color: GROUP_COLORS[canonicalArtist],
      points: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }).filter((series) => series.points.length);
}

function renderKugouHistory(payload, service) {
  const chartSection = byId('kugouJapanChartSection');
  const historySection = byId('kugouJapanHistorySection');
  const visible = service === 'kugou_music';
  if (chartSection) chartSection.hidden = !visible;
  if (historySection) historySection.hidden = !visible;
  if (!visible) return;

  const chart = payload?.kugou_japan_chart || {};
  const history = Array.isArray(chart.history) ? chart.history : [];
  const coverage = chart.coverage || {};
  const series = kugouSeries(history);
  const dates = [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
  const ranks = series.flatMap((item) => item.points.map((point) => point.rank));
  const maxRank = Math.max(1, ...ranks);
  const yMax = Math.max(10, Math.ceil(maxRank / 10) * 10);
  const rankTicks = [...new Set([1, 25, 50, 75, 100, yMax].filter((rank) => rank <= yMax))].sort((a, b) => a - b);

  renderRankHistoryChart({
    container: byId('kugouJapanRankChart'),
    series,
    dates,
    height: 420,
    margin: { left: 58, right: 18, top: 18, bottom: 38 },
    yMax,
    rankTicks,
    dateTickCount: 5,
    ariaLabel: 'Kugou日本榜における櫻坂46、乃木坂46、日向坂46の各日最高順位推移。1位が上。',
    lineClass: 'kugou-rank-line',
    emptyClass: 'regional-music-rank-empty',
    emptyText: 'Kugou日本榜の順位履歴はまだありません。',
    rankLabel: (rank) => `${rank}位`,
    dateLabel: providerShortDate,
    latestPoint: { radius: () => 2.5 },
    legendContainer: byId('kugouJapanRankLegend'),
  });

  const oldest = providerDateTimeText(coverage.oldest_available);
  const latestChecked = providerDateTimeText(coverage.latest_checked || coverage.latest_available);
  const latestRankIn = providerDateTimeText(coverage.latest_rank_in || coverage.latest_available);
  const count = Number.isFinite(Number(coverage.entries)) ? integerFormat.format(Number(coverage.entries)) : integerFormat.format(history.length);
  setText('kugouJapanCoverage', `最古取得可能: ${oldest} / 最終確認号: ${latestChecked} / 最終ランクイン: ${latestRankIn}（${count}件）。2024/10/31より前は現行APIでは正しい過去Top 100を復元できないため未収録。`);

  const body = replaceBody('kugouJapanHistoryBody');
  if (!body) return;
  const ordered = [...history].sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')) || Number(a.rank) - Number(b.rank));
  if (!ordered.length) {
    appendEmptyTableRow(body, 'Kugou日本榜のランクイン履歴はまだありません。', 5);
    return;
  }
  for (const item of ordered) {
    body.append(row([
      providerDateTimeText(item.published_at),
      ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      Number.isFinite(Number(item.rank)) ? `${integerFormat.format(Number(item.rank))}位` : '-',
      item.title || '-',
      Number.isFinite(Number(item.issue)) ? `第${integerFormat.format(Number(item.issue))}期` : '-',
    ]));
  }
}

function renderService(payload, service) {
  const state = (payload.services || []).find((item) => item.service === service) || null;
  const artists = (payload.artists || []).filter((item) => item.service === service);
  const tracks = (payload.tracks || []).filter((item) => item.service === service);
  const playlists = (payload.playlists || []).filter((item) => item.service === service);
  const memberships = (payload.playlist_memberships || []).filter((item) => item.service === service);

  setText('regionalMusicTitle', SERVICE_LABELS[service] || service);
  setText('regionalMusicRegion', state?.region || '');
  setText('regionalMusicUpdated', dateTimeText(payload.updated_at));
  setText('regionalMusicStatus', STATUS_LABELS[state?.status] || state?.status || '未取得');
  setText('regionalMusicArtistCount', integerFormat.format(artists.length));
  setText('regionalMusicTrackCount', integerFormat.format(tracks.length));
  setText('regionalMusicPlaylistCount', integerFormat.format(playlists.length));

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
  renderKugouHistory(payload, service);
  renderArtists(artists);
  renderTracks(tracks, payload.artist_track_orders);
  renderPlaylists(playlists, memberships);
}

function resetKugouSections() {
  const chartSection = byId('kugouJapanChartSection');
  const historySection = byId('kugouJapanHistorySection');
  if (chartSection) chartSection.hidden = true;
  if (historySection) historySection.hidden = true;
  for (const id of ['kugouJapanRankLegend', 'kugouJapanRankChart', 'kugouJapanHistoryBody']) replaceBody(id);
  setText('kugouJapanCoverage', '');
}

export async function loadRegionalMusicView(service) {
  const request = ++activeRequest;
  const serviceId = String(service || location.hash.slice(1) || '');
  if (!SERVICE_LABELS[serviceId]) throw new Error(`unknown regional music service: ${serviceId}`);
  setText('regionalMusicTitle', SERVICE_LABELS[serviceId]);
  for (const id of ['regionalMusicUpdated', 'regionalMusicStatus', 'regionalMusicArtistCount', 'regionalMusicTrackCount', 'regionalMusicPlaylistCount']) setText(id, '-');
  setText('regionalMusicRegion', '');
  for (const id of ['regionalMusicHealth', 'regionalMusicArtistBody', 'regionalMusicTrackBody', 'regionalMusicPlaylistBody']) replaceBody(id);
  resetKugouSections();
  setNotice('regionalMusicNotice', 'データを読み込んでいます。');
  try {
    const payload = await loadReadModel();
    if (request === activeRequest) renderService(payload, serviceId);
  } catch (error) {
    if (request !== activeRequest) return;
    setNotice('regionalMusicNotice', 'データを取得できませんでした。時間をおいて再度お試しください。', true);
    appendEmptyTableRow(byId('regionalMusicArtistBody'), 'データ未取得', 4);
    appendEmptyTableRow(byId('regionalMusicTrackBody'), 'データ未取得', 7);
    appendEmptyTableRow(byId('regionalMusicPlaylistBody'), 'データ未取得', 4);
  }
}