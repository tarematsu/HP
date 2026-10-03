import {
  appendEmptyTableRow,
  byId,
  integerFormat,
  setNotice,
  setText,
} from './dashboard-ui-common.js?v=20261001.1';

const SERVICE = 'youtube_music';
const ARTIST_LABELS = Object.freeze({
  sakurazaka46: '櫻坂46',
  nogizaka46: '乃木坂46',
  hinatazaka46: '日向坂46',
  aobazaka46: '青葉坂46',
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

function optionalText(value) {
  const text = String(value ?? '').trim();
  return !text || text.toLowerCase() === 'unknown' ? '-' : text;
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
    readModelPromise = fetch('/api/regional-music?service=youtube_music', {
      headers: { accept: 'application/json' },
      cache: 'default',
    }).then(async (response) => {
      if (!response.ok) throw new Error(`YouTube Music read model HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload?.ok || payload.service !== SERVICE) {
        throw new Error(payload?.error || 'YouTube Music read model unavailable');
      }
      return payload;
    }).catch((error) => {
      readModelPromise = null;
      throw error;
    });
  }
  return readModelPromise;
}

function renderArtists(items) {
  const body = replaceBody('youtubeMusicArtistBody');
  if (!body) return;
  if (!items.length) {
    appendEmptyTableRow(body, 'アーティストデータがありません。', 5);
    return;
  }
  for (const item of items) {
    body.append(row([
      ARTIST_LABELS[item.canonical_artist] || item.display_name || item.canonical_artist || '-',
      valueText(item.followers),
      valueText(item.monthly_audience),
      valueText(item.total_views),
      item.service_artist_id || '-',
    ]));
  }
}

function renderReleases(items) {
  const body = replaceBody('youtubeMusicReleaseBody');
  if (!body) return;
  if (!items.length) {
    appendEmptyTableRow(body, '作品データがありません。', 4);
    return;
  }
  for (const item of items) {
    body.append(row([
      ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      item.title || item.service_release_id || '-',
      optionalText(item.release_type),
      valueText(item.release_year),
    ]));
  }
}

function renderTracks(items) {
  const body = replaceBody('youtubeMusicTrackBody');
  if (!body) return;
  if (!items.length) {
    appendEmptyTableRow(body, '楽曲データがありません。', 4);
    return;
  }
  for (const item of items) {
    body.append(row([
      ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      item.title || item.service_track_id || '-',
      item.album_name || '-',
      item.service_track_id || '-',
    ]));
  }
}

function renderPlaylists(items, memberships) {
  const body = replaceBody('youtubeMusicPlaylistBody');
  if (!body) return;
  if (!items.length) {
    appendEmptyTableRow(body, '公開プレイリストデータがありません。', 3);
    return;
  }
  const counts = new Map();
  for (const membership of memberships) {
    const id = String(membership.service_playlist_id || '');
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  for (const item of items) {
    body.append(row([
      item.playlist_name || item.service_playlist_id || '-',
      item.playlist_type || '-',
      valueText(counts.get(String(item.service_playlist_id || '')) || 0),
    ]));
  }
}

function renderHealth(state) {
  const mount = byId('youtubeMusicHealth');
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

function render(payload) {
  const state = (payload.services || []).find((item) => item.service === SERVICE) || null;
  const artists = (payload.artists || []).filter((item) => item.service === SERVICE);
  const tracks = (payload.tracks || []).filter((item) => item.service === SERVICE);
  const releases = (payload.releases || []).filter((item) => item.service === SERVICE);
  const playlists = (payload.playlists || []).filter((item) => item.service === SERVICE);
  const memberships = (payload.playlist_memberships || []).filter((item) => item.service === SERVICE);

  setText('youtubeMusicUpdated', dateTimeText(payload.updated_at));
  setText('youtubeMusicStatus', STATUS_LABELS[state?.status] || state?.status || '未取得');
  setText('youtubeMusicArtistCount', integerFormat.format(artists.length));
  setText('youtubeMusicTrackCount', integerFormat.format(tracks.length));
  setText('youtubeMusicReleaseCount', integerFormat.format(releases.length));

  if (state?.status === 'error') {
    setNotice('youtubeMusicNotice', 'YouTube Music公開データの収集でエラーが発生しています。直前までの正常データは保持されています。', true);
  } else if (state?.status === 'degraded') {
    setNotice('youtubeMusicNotice', 'YouTube Music公開データの一部取得に失敗しています。取得できたデータのみ表示します。');
  } else if (!state) {
    setNotice('youtubeMusicNotice', 'YouTube Music公開データは次回収集後に表示されます。');
  } else {
    setNotice('youtubeMusicNotice');
  }

  renderHealth(state);
  renderArtists(artists);
  renderReleases(releases);
  renderTracks(tracks);
  renderPlaylists(playlists, memberships);
}

export async function loadYoutubeMusicView() {
  setNotice('youtubeMusicNotice', 'YouTube Music公開データを読み込んでいます。');
  try {
    const payload = await loadReadModel();
    render(payload);
  } catch {
    setNotice('youtubeMusicNotice', 'データを取得できませんでした。時間をおいて再度お試しください。', true);
    for (const [id, columns] of [['youtubeMusicArtistBody', 5], ['youtubeMusicReleaseBody', 4], ['youtubeMusicTrackBody', 4], ['youtubeMusicPlaylistBody', 3]]) {
      appendEmptyTableRow(byId(id), 'データ未取得', columns, { replace: true });
    }
  }
}
