import {
  byId as element,
  dashboardDataCard,
  dashboardTable,
  integerFormat,
  safeInteger as integer,
} from './dashboard-ui-common.js?v=20261001.1';

const ARTISTS = Object.freeze({
  sakurazaka46: Object.freeze({ key: 'sakurazaka46', name: '櫻坂46' }),
  nogizaka46: Object.freeze({ key: 'nogizaka46', name: '乃木坂46' }),
  hinatazaka46: Object.freeze({ key: 'hinatazaka46', name: '日向坂46' }),
});
const DEFAULT_ARTIST_KEY = 'sakurazaka46';
let selectedArtistKey = DEFAULT_ARTIST_KEY;
let loadPromise = null;
let lastPayload = null;

function selectedArtist() {
  return ARTISTS[selectedArtistKey] || ARTISTS[DEFAULT_ARTIST_KEY];
}

function ensurePlaylistTable() {
  const existing = element('applePlaylistTable');
  if (existing) return existing;
  const view = element('appleMusicView');
  if (!view) return null;

  const table = dashboardTable({
    id: 'applePlaylistTable',
    className: 'apple-table apple-playlist-table music-service-playlist-table',
    wrapClassName: 'apple-region-table-wrap',
  });
  const holder = document.createElement('div');
  holder.innerHTML = dashboardDataCard({
    title: '櫻坂46 楽曲別プレイリスト掲載一覧',
    titleId: 'applePlaylistTitle',
    kicker: 'PLAYLISTS',
    className: 'apple-data-panel music-service-panel',
    bodyHtml: `<p id="applePlaylistNote" class="music-service-playlist-note">Apple Music公式サイト上で検出できた公開プレイリストを、櫻坂46楽曲ごとに表示します。</p>${table}`,
  });
  const panel = holder.firstElementChild;
  if (!panel) return null;
  (element('applePlaylistMount') || view).append(panel);
  return element('applePlaylistTable');
}

function safeAppleMusicUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'music.apple.com' ? url.toString() : null;
  } catch {
    return null;
  }
}

function renderMessage(table, message) {
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

function trackArtistKey(track) {
  return String(track?.artist_key || DEFAULT_ARTIST_KEY);
}

function tracksForSelectedArtist(payload) {
  return (Array.isArray(payload?.tracks) ? payload.tracks : [])
    .filter((track) => trackArtistKey(track) === selectedArtist().key);
}

function renderSummary(tracks) {
  const playlistIds = new Set();
  for (const track of tracks) {
    for (const membership of Array.isArray(track?.playlists) ? track.playlists : []) {
      const id = String(membership?.id || membership?.url || membership?.name || '').trim();
      if (id) playlistIds.add(id);
    }
  }
  const playlistCount = element('applePlaylistCount');
  const trackCount = element('applePlaylistTrackCount');
  if (playlistCount) playlistCount.textContent = integerFormat.format(playlistIds.size);
  if (trackCount) trackCount.textContent = integerFormat.format(tracks.length);
}

function renderArtistLabels() {
  const artist = selectedArtist();
  const title = element('applePlaylistTitle');
  const note = element('applePlaylistNote');
  if (title) title.textContent = `${artist.name} 楽曲別プレイリスト掲載一覧`;
  if (note) note.textContent = `Apple Music公式サイト上で検出できた公開プレイリストを、${artist.name}楽曲ごとに表示します。`;
}

function render(payload) {
  const table = ensurePlaylistTable();
  if (!table) return;
  renderArtistLabels();
  const tracks = tracksForSelectedArtist(payload);
  renderSummary(tracks);
  if (!tracks.length) {
    renderMessage(table, `${selectedArtist().name}の対象曲を含む公開プレイリストはまだ検出されていません。`);
    return;
  }

  table.replaceChildren();
  const thead = document.createElement('thead');
  const header = document.createElement('tr');
  for (const label of ['曲名', '掲載数', 'プレイリスト']) {
    const th = document.createElement('th');
    th.textContent = label;
    header.append(th);
  }
  thead.append(header);

  const tbody = document.createElement('tbody');
  for (const track of tracks) {
    const memberships = Array.isArray(track?.playlists) ? track.playlists : [];
    const row = document.createElement('tr');
    const title = document.createElement('td');
    title.textContent = track?.title || '曲名不明';
    title.className = 'apple-song-title';
    const count = document.createElement('td');
    count.textContent = String(memberships.length);
    count.className = 'apple-rank-number';
    const playlistCell = document.createElement('td');
    const links = document.createElement('div');
    links.className = 'music-service-playlist-links';

    for (const membership of memberships) {
      const line = document.createElement('div');
      const url = safeAppleMusicUrl(membership?.url);
      if (url) {
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = membership?.name || membership?.id || 'プレイリスト';
        line.append(anchor);
      } else {
        line.textContent = membership?.name || membership?.id || 'プレイリスト';
      }
      const curator = String(membership?.curator || '').trim();
      const position = integer(membership?.position);
      const details = [curator || null, position != null ? `${position}曲目` : null].filter(Boolean);
      if (details.length) line.append(document.createTextNode(`（${details.join('・')}）`));
      links.append(line);
    }
    playlistCell.append(links);
    row.append(title, count, playlistCell);
    tbody.append(row);
  }
  table.append(thead, tbody);
}

async function fetchPayload() {
  const response = await fetch('/api/apple-music-playlists', { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || `Apple Music playlist API HTTP ${response.status}`);
  }
  return payload;
}

export async function loadAppleMusicPlaylistMemberships({ force = false } = {}) {
  if (!force && lastPayload) {
    render(lastPayload);
    return lastPayload;
  }
  if (!loadPromise || force) {
    loadPromise = fetchPayload().then((payload) => {
      lastPayload = payload;
      render(payload);
      return payload;
    }).catch((error) => {
      const table = ensurePlaylistTable();
      if (table) renderMessage(table, 'プレイリスト情報の取得に失敗しました。');
      throw error;
    }).finally(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

globalThis.document?.querySelectorAll('[data-apple-artist]').forEach((button) => button.addEventListener('click', () => {
  selectedArtistKey = button.dataset.appleArtist || DEFAULT_ARTIST_KEY;
  if (lastPayload) render(lastPayload);
}));
