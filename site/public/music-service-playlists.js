import {
  byId as element,
  dashboardDataCard,
  dashboardTable,
  integerFormat,
} from './dashboard-ui-common.js?v=20261001.1';

const CONFIGS = Object.freeze({
  spotify: Object.freeze({
    endpoint: '/api/spotify-playlists',
    mountId: 'spotifyPlaylistMount',
    tableId: 'spotifyPlaylistTable',
    playlistCountId: 'spotifyPlaylistCount',
    trackCountId: 'spotifyPlaylistTrackCount',
    className: 'spotify-data-panel',
    note: 'Spotify公開ページ上で検出できた、櫻坂46楽曲を含むプレイリストを表示します。',
    hosts: new Set(['open.spotify.com']),
  }),
  apple: Object.freeze({
    endpoint: '/api/apple-music-playlists',
    mountId: 'applePlaylistMount',
    tableId: 'applePlaylistTable',
    playlistCountId: 'applePlaylistCount',
    trackCountId: 'applePlaylistTrackCount',
    className: 'apple-data-panel',
    note: 'Apple Music公式サイト上で検出できた公開プレイリストを表示します。',
    hosts: new Set(['music.apple.com']),
  }),
  amazon: Object.freeze({
    endpoint: '/api/amazon-music-playlists',
    mountId: 'amazonPlaylistMount',
    tableId: 'amazonPlaylistTable',
    playlistCountId: 'amazonPlaylistCount',
    trackCountId: 'amazonPlaylistTrackCount',
    className: 'amazon-data-panel',
    note: 'Amazon Musicの曲詳細から検出した関連プレイリストを表示します。',
    hosts: new Set(['music.amazon.co.jp']),
  }),
});

const requests = new Map();
const payloads = new Map();

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function ensureTable(config) {
  const existing = element(config.tableId);
  if (existing) return existing;
  const mount = element(config.mountId);
  if (!mount) return null;
  const table = dashboardTable({
    id: config.tableId,
    className: 'music-service-playlist-table',
    wrapClassName: 'table-fit-mobile',
  });
  const holder = document.createElement('div');
  holder.innerHTML = dashboardDataCard({
    title: '楽曲別プレイリスト掲載一覧',
    className: `music-service-panel ${config.className}`,
    bodyHtml: `<p class="music-service-playlist-note">${config.note}</p>${table}`,
  });
  if (holder.firstElementChild) mount.append(holder.firstElementChild);
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
  const row = document.createElement('tr');
  const cell = document.createElement('td');
  cell.colSpan = 3;
  cell.className = 'music-service-playlist-empty';
  cell.textContent = message;
  row.append(cell);
  tbody.append(row);
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

function renderTable(config, payload) {
  const table = ensureTable(config);
  if (!table) return;
  const tracks = normalizedTracks(payload)
    .filter((track) => Array.isArray(track.playlists) && track.playlists.length)
    .sort((a, b) => String(a.title).localeCompare(String(b.title), 'ja'));
  setMetric(config.playlistCountId, playlistSet(tracks).size);
  setMetric(config.trackCountId, tracks.length);

  if (!tracks.length) {
    renderMessage(table, '対象曲を含む公開プレイリストはまだ検出されていません。');
    return;
  }

  table.replaceChildren();
  const thead = document.createElement('thead');
  const head = document.createElement('tr');
  for (const label of ['曲名', '掲載数', 'プレイリスト']) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  thead.append(head);

  const tbody = document.createElement('tbody');
  for (const track of tracks) {
    const memberships = Array.isArray(track.playlists) ? track.playlists : [];
    const row = document.createElement('tr');
    const title = document.createElement('td');
    title.textContent = track.title || '曲名不明';
    const count = document.createElement('td');
    count.textContent = integerFormat.format(memberships.length);
    const playlistCell = document.createElement('td');
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
    playlistCell.append(links);
    row.append(title, count, playlistCell);
    tbody.append(row);
  }
  table.append(thead, tbody);
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
  if (!force && payloads.has(key)) {
    const payload = payloads.get(key);
    renderTable(config, payload);
    return payload;
  }
  if (!requests.has(key) || force) {
    const request = fetchPayload(config)
      .then((payload) => {
        payloads.set(key, payload);
        renderTable(config, payload);
        return payload;
      })
      .catch((error) => {
        renderMessage(ensureTable(config), 'プレイリスト情報の取得に失敗しました。');
        throw error;
      })
      .finally(() => requests.delete(key));
    requests.set(key, request);
  }
  return requests.get(key);
}
