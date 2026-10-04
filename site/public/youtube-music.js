import {
  appendEmptyTableRow,
  byId,
  setNotice,
  setText,
} from './dashboard-ui-common.js?v=20261001.1';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';
import {
  MUSIC_ARTIST_LABELS,
  loadMusicServiceReadModel,
  musicDateTimeText,
  musicValueText,
  replaceMusicTableBody,
} from './music-service-runtime-common.js?v=20261004.2';

const SERVICE = 'youtube_music';

function optionalText(value) {
  const text = String(value ?? '').trim();
  return !text || text.toLowerCase() === 'unknown' ? '-' : text;
}

function renderArtists(items) {
  const body = replaceMusicTableBody('youtubeMusicArtistBody');
  if (!body) return;
  if (!items.length) {
    appendEmptyTableRow(body, 'アーティストデータがありません。', 5);
    return;
  }
  for (const item of items) {
    appendTableRow(body, [
      MUSIC_ARTIST_LABELS[item.canonical_artist] || item.display_name || item.canonical_artist || '-',
      musicValueText(item.followers),
      musicValueText(item.monthly_audience),
      musicValueText(item.total_views),
      item.service_artist_id || '-',
    ]);
  }
}

function renderReleases(items) {
  const body = replaceMusicTableBody('youtubeMusicReleaseBody');
  if (!body) return;
  if (!items.length) {
    appendEmptyTableRow(body, '作品データがありません。', 4);
    return;
  }
  for (const item of items) {
    appendTableRow(body, [
      MUSIC_ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      item.title || item.service_release_id || '-',
      optionalText(item.release_type),
      musicValueText(item.release_year),
    ]);
  }
}

function renderTracks(items) {
  const body = replaceMusicTableBody('youtubeMusicTrackBody');
  if (!body) return;
  if (!items.length) {
    appendEmptyTableRow(body, '楽曲データがありません。', 5);
    return;
  }
  for (const item of items) {
    appendTableRow(body, [
      MUSIC_ARTIST_LABELS[item.canonical_artist] || item.canonical_artist || '-',
      item.title || item.service_track_id || '-',
      musicValueText(item.plays),
      item.album_name || '-',
      item.service_track_id || '-',
    ]);
  }
}

function renderPlaylists(items, memberships) {
  const body = replaceMusicTableBody('youtubeMusicPlaylistBody');
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
    appendTableRow(body, [
      item.playlist_name || item.service_playlist_id || '-',
      item.playlist_type || '-',
      musicValueText(counts.get(String(item.service_playlist_id || '')) || 0),
    ]);
  }
}

function render(payload) {
  const state = (payload.services || []).find((item) => item.service === SERVICE) || null;
  const artists = (payload.artists || []).filter((item) => item.service === SERVICE);
  const tracks = (payload.tracks || []).filter((item) => item.service === SERVICE);
  const releases = (payload.releases || []).filter((item) => item.service === SERVICE);
  const playlists = (payload.playlists || []).filter((item) => item.service === SERVICE);
  const memberships = (payload.playlist_memberships || []).filter((item) => item.service === SERVICE);

  setText('youtubeMusicUpdated', musicDateTimeText(payload.updated_at));

  if (state?.status === 'error') {
    setNotice('youtubeMusicNotice', 'YouTube Music公開データの収集でエラーが発生しています。直前までの正常データは保持されています。', true);
  } else if (state?.status === 'degraded') {
    setNotice('youtubeMusicNotice', 'YouTube Music公開データの一部取得に失敗しています。取得できたデータのみ表示します。');
  } else if (!state) {
    setNotice('youtubeMusicNotice', 'YouTube Music公開データは次回収集後に表示されます。');
  } else {
    setNotice('youtubeMusicNotice');
  }

  renderArtists(artists);
  renderReleases(releases);
  renderTracks(tracks);
  renderPlaylists(playlists, memberships);
}

export async function loadYoutubeMusicView() {
  setNotice('youtubeMusicNotice', 'YouTube Music公開データを読み込んでいます。');
  try {
    render(await loadMusicServiceReadModel(SERVICE));
  } catch {
    setNotice('youtubeMusicNotice', 'データを取得できませんでした。時間をおいて再度お試しください。', true);
    for (const [id, columns] of [['youtubeMusicArtistBody', 5], ['youtubeMusicReleaseBody', 4], ['youtubeMusicTrackBody', 5], ['youtubeMusicPlaylistBody', 3]]) {
      appendEmptyTableRow(byId(id), 'データ未取得', columns, { replace: true });
    }
  }
}