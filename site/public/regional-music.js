import {
  appendEmptyTableRow,
  byId,
  integerFormat,
  setNotice,
  setText,
} from './dashboard-ui-common.js?v=20261001.1';

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

const STATUS_LABELS = Object.freeze({
  ok: '正常',
  degraded: '一部取得',
  pending: '待機',
  error: 'エラー',
});

let readModelPromise = null;

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

function renderArtists(rows) {
  const body = replaceBody('regionalMusicArtistBody');
  if (!body) return;
  if (!rows.length) {
    appendEmptyTableRow(body, 'アーティストデータがありません。', 4);
    return;
  }
  for (const item of rows) {
    body.append(row([
      ARTIST_LABELS[item.canonical_artist] || item.display_name || item.canonical_artist || '-',
      valueText(item.followers),
      valueText(item.likes),
      item.service_artist_id || '-',
    ]));
  }
}

function renderTracks(rows) {
  const body = replaceBody('regionalMusicTrackBody');
  if (!body) return;
  if (!rows.length) {
    appendEmptyTableRow(body, '楽曲データがありません。', 7);
    return;
  }
  for (const item of rows) {
    body.append(row([
      ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      item.title || item.service_track_id || '-',
      valueText(item.plays),
      valueText(item.listeners),
      valueText(item.likes),
      valueText(item.comments),
      valueText(item.popularity_rank),
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
  renderArtists(artists);
  renderTracks(tracks);
  renderPlaylists(playlists, memberships);
}

export async function loadRegionalMusicView(service) {
  const serviceId = String(service || location.hash.slice(1) || '');
  if (!SERVICE_LABELS[serviceId]) throw new Error(`unknown regional music service: ${serviceId}`);
  setText('regionalMusicTitle', SERVICE_LABELS[serviceId]);
  setNotice('regionalMusicNotice', 'データを読み込んでいます。');
  const payload = await loadReadModel();
  renderService(payload, serviceId);
}
