import {
  appendEmptyTableRow,
  byId as element,
  dashboardTable,
  integerFormat,
} from './dashboard-ui-common.js?v=20261004.1';
import { appendTableRow, replaceTableHeader } from './dashboard-table-dom.js?v=20261001.1';
import { MUSIC_ARTIST_LABELS } from './music-service-runtime-common.js?v=20261004.1';

const CONFIGS = Object.freeze({
  spotify: Object.freeze({
    endpoint: '/api/spotify-playlists',
    mountId: 'spotifyPlaylistMount',
    tableId: 'spotifyPlaylistTable',
    playlistCountId: 'spotifyPlaylistCount',
    trackCountId: 'spotifyPlaylistTrackCount',
    note: 'Spotify公開ページ上で検出できた、櫻坂46楽曲を含むプレイリストを表示します。',
    hosts: new Set(['open.spotify.com']),
  }),
  apple: Object.freeze({
    endpoint: '/api/apple-music-playlists',
    mountId: 'applePlaylistMount',
    tableId: 'applePlaylistTable',
    playlistCountId: 'applePlaylistCount',
    trackCountId: 'applePlaylistTrackCount',
    noteId: 'applePlaylistNote',
    titleId: 'applePlaylistTitle',
    artistFilterAttribute: 'apple-artist',
    defaultArtistKey: 'sakurazaka46',
    note: 'Apple Music公式サイト上で検出できた公開プレイリストを表示します。',
    hosts: new Set(['music.apple.com']),
  }),
  amazon: Object.freeze({
    endpoint: '/api/amazon-music-playlists',
    mountId: 'amazonPlaylistMount',
    tableId: 'amazonPlaylistTable',
    playlistCountId: 'amazonPlaylistCount',
    trackCountId: 'amazonPlaylistTrackCount',
    note: 'Amazon Musicの曲詳細から検出した関連プレイリストを表示します。',
    hosts: new Set(['music.amazon.co.jp']),
  }),
});

const requests = new Map();
const payloads = new Map();
const selectedArtists = new Map();

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function selectedArtistKey(service, config) {
  return selectedArtists.get(service) || config.defaultArtistKey || '';
}

function selectedArtistName(service, config) {
  const key = selectedArtistKey(service, config);
  return MUSIC_ARTIST_LABELS[key] || key || '';
}

function noteText(service, config) {
  if (!config.artistFilterAttribute) return config.note;
  const artist = selectedArtistName(service, config);
  return `Apple Music公式サイト上で検出できた公開プレイリストを、${artist}楽曲ごとに表示します。`;
}

function ensureTable(service, config) {
  const existing = element(config.tableId);
  if (existing) return existing;
  const mount = element(config.mountId);
  if (!mount) return null;
  const table = dashboardTable({
    id: config.tableId,
    className: 'regional-music-table music-service-playlist-table',
    wrapClassName: 'table-fit-mobile',
  });
  mount.insertAdjacentHTML('beforeend', `<p${config.noteId ? ` id="${config.noteId}"` : ''} class="music-service-playlist-note">${noteText(service, config)}</p>${table}`);
  return element(config.tableId);
}

function trackIdentity(track) {
  return text(track?.track_id)
    || text(track?.spotify_id)
    || text(track?.apple_music_id)
    || text(track?.amazon_music_id)
    || text(track?.title)
    || text(track?.name);
}

function membershipIdentity(membership) {
  return text(membership?.id)
    || text(membership?.playlist_id)
    || text(membership?.url)
    || text(membership?.name);
}

function normalizedTracks(payload) {
  const direct = Array.isArray(payload?.tracks) ? payload.tracks : [];
  if (direct.some((track) => Array.isArray(track?.playlists))) {
    return direct.map((track) => ({
      ...track,
      title: text(track?.title || track?.name) || '曲名不明',
      playlists: Array.isArray(track?.playlists) ? track.playlists : [],
    }));
  }

  const grouped = new Map();
  for (const playlist of Array.isArray(payload?.playlists) ? payload.playlists : []) {
    for (const track of Array.isArray(playlist?.tracks) ? playlist.tracks : []) {
      const key = trackIdentity(track);
      if (!key) continue;
      if (!grouped.has(key)) {
        grouped.set(key, {
          ...track,
          title: text(track?.title || track?.name) || '曲名不明',
          playlists: [],
        });
      }
      grouped.get(key).playlists.push({
        id: playlist?.id,
        playlist_id: playlist?.playlist_id,
        name: playlist?.name,
        curator: playlist?.curator,
        url: playlist?.url,
        position: track?.position,
      });
    }
  }
  return [...grouped.values()];
}

function safeUrl(value, hosts) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && hosts.has(url.hostname) ? url.toString() : null;
  } catch {
    return null;
  }
}

function setMetric(id, value) {
  const node = element(id);
  if (node) node.textContent = integerFormat.format(Math.max(0, Number(value) || 0));
}

function renderMessage(table, message) {
  if (!table) return;
  table.replaceChildren();
  const tbody = document.createElement('tbody');
  appendEmptyTableRow(tbody, message, 3, { className:'music-service-playlist-empty' });
  table.append(tbody);
}

function playlistSet(tracks) {
  const ids = new Set();
  for (const track of tracks) {
    for (const membership of Array.isArray(track?.playlists) ? track.playlists : []) {
      const key = membershipIdentity(membership);
      if (key) ids.add(key);
    }
  }
  return ids;
}

function filteredTracks(service, config, payload) {
  const tracks = normalizedTracks(payload);
  if (!config.artistFilterAttribute) return tracks;
  const artistKey = selectedArtistKey(service, config);
  return tracks.filter((track) => String(track?.artist_key || config.defaultArtistKey || '') === artistKey);
}

function syncArtistLabels(service, config) {
  if (!config.artistFilterAttribute) return;
  const artist = selectedArtistName(service, config);
  const title = element(config.titleId);
  const note = element(config.noteId);
  if (title) title.textContent = `${artist} 楽曲別プレイリスト掲載一覧`;
  if (note) note.textContent = noteText(service, config);
}

function renderTable(service, config, payload) {
  const table = ensureTable(service, config);
  if (!table) return;
  syncArtistLabels(service, config);
  const tracks = filteredTracks(service, config, payload)
    .filter((track) => Array.isArray(track.playlists) && track.playlists.length)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), 'ja'));
  setMetric(config.playlistCountId, playlistSet(tracks).size);
  setMetric(config.trackCountId, tracks.length);

  if (!tracks.length) {
    const artist = selectedArtistName(service, config);
    renderMessage(table, artist
      ? `${artist}の対象曲を含む公開プレイリストはまだ検出されていません。`
      : '対象曲を含む公開プレイリストはまだ検出されていません。');
    return;
  }

  table.replaceChildren();
  const thead = document.createElement('thead');
  replaceTableHeader(thead, ['曲名', '掲載数', 'プレイリスト']);
  const tbody = document.createElement('tbody');
  for (const track of tracks) {
    const memberships = Array.isArray(track.playlists) ? track.playlists : [];
    const links = document.createElement('div');
    links.className = 'music-service-playlist-links';

    for (const membership of memberships) {
      const line = document.createElement('div');
      const url = safeUrl(membership?.url, config.hosts);
      const label = text(membership?.name) || text(membership?.id) || text(membership?.playlist_id) || 'プレイリスト';
      if (url) {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = label;
        line.append(anchor);
      } else {
        line.textContent = label;
      }
      const curator = text(membership?.curator);
      const position = Number(membership?.position);
      const details = [curator, Number.isSafeInteger(position) && position > 0 ? `${position}曲目` : null].filter(Boolean);
      if (details.length) line.append(document.createTextNode(`（${details.join('・')}）`));
      links.append(line);
    }
    appendTableRow(tbody, [
      track.title || '曲名不明',
      integerFormat.format(memberships.length),
      { node:links },
    ]);
  }
  table.append(thead, tbody);
}

function bindArtistFilter(service, config) {
  if (!config.artistFilterAttribute) return;
  const selector = `[data-${config.artistFilterAttribute}]`;
  const datasetKey = config.artistFilterAttribute.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  for (const button of document.querySelectorAll(selector)) {
    const marker = `${service}PlaylistBound`;
    if (button.dataset[marker] === '1') continue;
    button.dataset[marker] = '1';
    button.addEventListener('click', () => {
      selectedArtists.set(service, button.dataset[datasetKey] || config.defaultArtistKey || '');
      if (payloads.has(service)) renderTable(service, config, payloads.get(service));
    });
  }
}

async function fetchPayload(config) {
  const response = await fetch(config.endpoint, { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `playlist API HTTP ${response.status}`);
  return payload;
}

export async function loadMusicServicePlaylists(service, { force = false } = {}) {
  const key = String(service || '').toLowerCase();
  const config = CONFIGS[key];
  if (!config) throw new Error(`Unknown music service: ${service}`);
  if (config.defaultArtistKey && !selectedArtists.has(key)) selectedArtists.set(key, config.defaultArtistKey);
  bindArtistFilter(key, config);
  if (!force && payloads.has(key)) {
    const payload = payloads.get(key);
    renderTable(key, config, payload);
    return payload;
  }
  if (!requests.has(key) || force) {
    const request = fetchPayload(config)
      .then((payload) => {
        payloads.set(key, payload);
        renderTable(key, config, payload);
        return payload;
      })
      .catch((error) => {
        renderMessage(ensureTable(key, config), 'プレイリスト情報の取得に失敗しました。');
        throw error;
      })
      .finally(() => requests.delete(key));
    requests.set(key, request);
  }
  return requests.get(key);
}
