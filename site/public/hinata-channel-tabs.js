import {
  appendEmptyTableRow,
  byId,
  finiteNumber as finite,
  integerFormat as integer,
  setText,
} from './dashboard-ui-common.js?v=20261001.1';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';

const HINATA_URL = '/api/hinata';
const REFRESH_INTERVAL_MS = 5 * 60_000;
const state = {
  payload: null,
  selectedPlayedPeriod: '',
  refreshTimer: 0,
};
const jstDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function numberText(value) {
  const parsed = finite(value);
  return parsed == null ? '—' : integer.format(Math.round(parsed));
}

function reducedImage(source, size = 200) {
  const value = String(source || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value, location.href);
    if (/stationhead-production1-images\.s3\.amazonaws\.com$/i.test(url.hostname)) {
      url.pathname = url.pathname.replace(/\/(?:76|200|340|672|800|960)\//, `/${size <= 76 ? 76 : 200}/`);
    } else if (/i\.scdn\.co$/i.test(url.hostname)) {
      url.pathname = url.pathname.replace(/ab67616d0000(?:b273|01e02|04851)/i, size <= 100 ? 'ab67616d00004851' : 'ab67616d0000b273');
    }
    return url.href;
  } catch {
    return value;
  }
}

function setImage(id, source, size = 200) {
  const image = byId(id);
  if (!image) return;
  const next = reducedImage(source, size);
  if (!next) {
    image.hidden = true;
    image.removeAttribute('src');
    return;
  }
  if (image.src !== next) image.src = next;
  image.hidden = false;
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.floor((finite(value) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function playbackView(payload = state.payload) {
  const queue = Array.isArray(payload?.queue) ? payload.queue : [];
  if (!queue.length) return { queue, index: -1, progress: 0, duration: 0 };
  let index = queue.findIndex((track) => track?.is_current);
  if (index < 0) index = Math.max(0, Number(payload?.queue_status?.current_index) || 0);
  const status = payload?.queue_status || {};
  const playing = status.playing ?? true;
  const anchor = finite(status.anchor_at);
  let progress = playing && anchor != null
    ? Math.max(0, Date.now() - anchor)
    : Math.max(0, finite(status.progress_ms) || finite(queue[index]?.progress_ms) || 0);
  while (index < queue.length - 1) {
    const duration = Math.max(0, finite(queue[index]?.duration_ms) || 0);
    if (!duration || progress < duration) break;
    progress -= duration;
    index += 1;
  }
  const duration = Math.max(0, finite(queue[index]?.duration_ms) || 0);
  return { queue, index, progress: duration ? Math.min(progress, duration) : progress, duration };
}

function updatePlaybackProgress(view = playbackView()) {
  const percent = view.duration > 0 ? Math.min(100, view.progress / view.duration * 100) : 0;
  setText('hinataTrackTime', `${formatDuration(view.progress)} / ${formatDuration(view.duration)}`);
  const bar = byId('hinataTrackBar');
  if (bar) bar.style.width = `${percent}%`;
}

function queueItem(track, index) {
  const link = document.createElement('a');
  link.className = 'queue-item';
  const url = String(track?.spotify_url || '').trim();
  link.href = url || '#';
  if (url) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  } else {
    link.addEventListener('click', (event) => event.preventDefault());
  }
  const position = document.createElement('span');
  position.className = 'queue-index';
  position.textContent = String(index + 1);
  const image = document.createElement('img');
  image.className = 'queue-thumb';
  image.alt = '';
  image.width = 42;
  image.height = 42;
  image.loading = 'lazy';
  image.decoding = 'async';
  const source = reducedImage(track?.thumbnail_url, 76);
  if (source) image.src = source;
  else image.hidden = true;
  const copy = document.createElement('span');
  copy.className = 'queue-copy';
  const title = document.createElement('strong');
  title.textContent = track?.title || track?.spotify_id || '曲名不明';
  const artist = document.createElement('small');
  artist.textContent = track?.artist || '';
  copy.append(title, artist);
  const duration = document.createElement('span');
  duration.className = 'queue-duration';
  duration.textContent = formatDuration(track?.duration_ms);
  link.append(position, image, copy, duration);
  return link;
}

function renderPlayback(payload) {
  const view = playbackView(payload);
  const current = view.index >= 0 ? view.queue[view.index] : null;
  const host = byId('hinataHost');
  if (host) {
    host.replaceChildren();
    const handle = String(payload?.latest?.host_handle || '').replace(/^@/, '').trim();
    if (handle) {
      const label = document.createElement('span');
      label.textContent = '配信ホスト ';
      const link = document.createElement('a');
      link.href = `https://stationhead.com/${encodeURIComponent(handle)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `@${handle}`;
      host.append(label, link);
    }
  }

  if (!current) {
    setText('hinataTrackTitle', 'キュー情報がありません');
    setText('hinataTrackArtist', '');
    setImage('hinataTrackImage', '');
  } else {
    setText('hinataTrackTitle', current.title || current.spotify_id || '曲名不明');
    setText('hinataTrackArtist', current.artist || '');
    setImage('hinataTrackImage', current.thumbnail_url, 200);
    const bites = finite(current.bite_count);
    const biteNode = byId('hinataTrackBites');
    if (biteNode) {
      biteNode.hidden = bites == null;
      biteNode.textContent = bites == null ? '' : `♡ ${integer.format(bites)}`;
    }
  }
  updatePlaybackProgress(view);

  const box = byId('hinataQueue');
  if (!box) return;
  const upcoming = view.queue.slice(Math.max(0, view.index + 1), Math.max(0, view.index + 1) + 5);
  const returned = finite(payload?.queue_status?.returned_items) ?? view.queue.length;
  const total = finite(payload?.queue_status?.total_items) ?? returned;
  setText('hinataQueueCount', `取得 ${numberText(returned)}曲／登録 ${numberText(total)}曲`);
  box.replaceChildren(...upcoming.map((track, index) => queueItem(track, index)));
  if (!upcoming.length) {
    const empty = document.createElement('p');
    empty.className = 'subtle';
    empty.textContent = '次の曲はありません。';
    box.append(empty);
  }
}

function periodLabel(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[2])}/${Number(match[3])}` : String(value || '—');
}

function playedRows(payload) {
  return (Array.isArray(payload?.played_history) ? payload.played_history : [])
    .filter((row) => row?.period_key)
    .sort((left, right) => String(right.period_key).localeCompare(String(left.period_key)));
}

function renderPlayedPeriod(payload) {
  const rows = playedRows(payload);
  if (!state.selectedPlayedPeriod || !rows.some((row) => row.period_key === state.selectedPlayedPeriod)) {
    state.selectedPlayedPeriod = rows[0]?.period_key || '';
  }
  const selected = rows.find((row) => row.period_key === state.selectedPlayedPeriod) || null;
  setText('hinataPlayedTotal', numberText(selected?.total_plays));
  setText('hinataPlayedUnique', numberText(selected?.unique_tracks));
  const tbody = byId('hinataPlayedTbody');
  if (!tbody) return;
  tbody.replaceChildren();
  const tracks = Array.isArray(selected?.tracks) ? selected.tracks : [];
  if (!tracks.length) {
    appendEmptyTableRow(tbody, '再生履歴データはまだありません。', 3, { className: 'shared-empty' });
    return;
  }
  const total = Math.max(1, Number(selected.total_plays) || tracks.reduce((sum, track) => sum + (Number(track?.count) || 0), 0));
  for (const track of tracks) {
    const count = Number(track?.count) || 0;
    const title = track?.artist ? `${track.title || '曲名不明'} / ${track.artist}` : (track?.title || '曲名不明');
    appendTableRow(tbody, [title, numberText(count), `${(count / total * 100).toFixed(1)}%`]);
  }
}

function renderPlayed(payload) {
  const strip = byId('hinataPlayedPeriodStrip');
  const rows = playedRows(payload);
  if (strip) {
    strip.replaceChildren(...rows.map((row) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = row.period_key === state.selectedPlayedPeriod ? 'active' : '';
      button.textContent = periodLabel(row.period_key);
      button.title = row.period_key;
      button.addEventListener('click', () => {
        state.selectedPlayedPeriod = row.period_key;
        renderPlayed(payload);
      });
      return button;
    }));
  }
  renderPlayedPeriod(payload);
}

function renderLikes(payload) {
  const likes = (Array.isArray(payload?.likes) ? payload.likes : [])
    .filter((row) => finite(row?.like_count) != null)
    .sort((left, right) => Number(right.like_count) - Number(left.like_count));
  setText('hinataLikesTrackCount', numberText(likes.length));
  setText('hinataLikesTotalLikes', numberText(likes.reduce((sum, row) => sum + Number(row.like_count || 0), 0)));
  const latestAt = likes.reduce((latest, row) => Math.max(latest, finite(row?.observed_at) || 0), 0);
  setText('hinataLikesLatestAt', latestAt ? `${jstDateTime.format(new Date(latestAt))} JST` : '—');

  const ranking = byId('hinataLikesRankingList');
  if (ranking) {
    ranking.replaceChildren(...likes.slice(0, 5).map((row) => {
      const item = document.createElement('li');
      const title = row?.title || row?.spotify_id || '曲名不明';
      item.textContent = `${title}${row?.artist ? ` / ${row.artist}` : ''}　♡ ${numberText(row.like_count)}`;
      return item;
    }));
    if (!likes.length) {
      const item = document.createElement('li');
      item.textContent = 'いいねデータはまだありません。';
      ranking.append(item);
    }
  }

  const tbody = byId('hinataLikesTbody');
  if (!tbody) return;
  tbody.replaceChildren();
  if (!likes.length) {
    appendEmptyTableRow(tbody, 'いいねデータはまだありません。', 5, { className: 'shared-empty' });
    return;
  }
  likes.forEach((row, index) => {
    appendTableRow(tbody, [
      String(index + 1),
      row?.title || row?.spotify_id || '曲名不明',
      row?.artist || '—',
      numberText(row?.like_count),
      finite(row?.observed_at) == null ? '—' : `${jstDateTime.format(new Date(row.observed_at))} JST`,
    ]);
  });
}

function render(payload) {
  state.payload = payload;
  renderPlayback(payload);
  renderPlayed(payload);
  renderLikes(payload);
  const notice = byId('hinataChannelNotice');
  if (notice) {
    notice.hidden = true;
    notice.textContent = '';
  }
}

async function refresh() {
  try {
    const response = await fetch(HINATA_URL, { headers: { accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `hinata API HTTP ${response.status}`);
    render(payload);
  } catch (error) {
    console.error(error);
    const notice = byId('hinataChannelNotice');
    if (notice) {
      notice.textContent = state.payload ? '曲情報の更新に失敗しました。保存済みの表示を継続します。' : '曲情報を取得できませんでした。';
      notice.classList.add('error');
      notice.hidden = false;
    }
  }
}

function selectSection(section) {
  const root = byId('hinataView');
  if (!root) return;
  root.querySelectorAll('[data-hinata-section]').forEach((button) => {
    const active = button.dataset.hinataSection === section;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  root.querySelectorAll('[data-hinata-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.hinataPanel !== section;
  });
}

byId('hinataView')?.querySelectorAll('[data-hinata-section]').forEach((button) => {
  button.addEventListener('click', () => selectSection(button.dataset.hinataSection || 'current'));
});
selectSection('current');
void refresh();
state.refreshTimer = setInterval(() => { if (!document.hidden) void refresh(); }, REFRESH_INTERVAL_MS);
setInterval(() => { if (!document.hidden && state.payload) updatePlaybackProgress(); }, 1_000);
