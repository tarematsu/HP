import {
  byId as element,
  dashboardDataCard,
  dashboardTable,
  safeInteger as integer,
} from './dashboard-ui-common.js?v=20261001.1';

let loadPromise = null;
let lastPayload = null;

function ensurePlaylistTable() {
  const existing = element('applePlaylistTable');
  if (existing) return existing;
  const view = element('appleMusicView');
  if (!view) return null;

  const table = dashboardTable({
    id: 'applePlaylistTable',
    className: 'apple-table apple-playlist-table',
    wrapClassName: 'apple-region-table-wrap',
  });
  const holder = document.createElement('div');
  holder.innerHTML = dashboardDataCard({
    title: '楽曲別プレイリスト掲載一覧',
    titleId: 'applePlaylistTitle',
    kicker: 'PUBLIC PLAYLISTS',
    className: 'apple-data-panel',
    bodyHtml: `<p class="apple-playlist-note">Apple Music公式サイト上で検出できた公開プレイリストを表示します。</p>${table}`,
  });
  const panel = holder.firstElementChild;
  if (!panel) return null;
  view.append(panel);
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
  cell.textContent = message;
  row.append(cell);
  tbody.append(row);
  table.append(tbody);
}

function render(payload) {
  const table = ensurePlaylistTable();
  if (!table) return;
  const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
  if (!tracks.length) {
    renderMessage(table, '対象曲を含む公開プレイリストはまだ検出されていません。');
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
    links.className = 'apple-playlist-links';

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
      const position = integer(membership?.position);
      if (position != null) line.append(document.createTextNode(`（${position}曲目）`));
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