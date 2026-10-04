import { byId, finiteNumber as finite, integerFormat as integer, setText } from './dashboard-ui-common.js?v=20260930.1';

import { fetchDashboard } from './dashboard-fetch-cache.js?v=20260930.1';
const DASHBOARD_URL = '/api/dashboard?history=0';
const REFRESH_INTERVAL_MS = 60_000;
const MIN_REFRESH_GAP_MS = 45_000;
const IMAGE_RETRY_DELAYS = [5_000, 30_000, 120_000];
const imageRetryTimers = new WeakMap();
const retryImages = new WeakSet();

const state = {
  payload: null,
  queue: [],
  playbackIndex: -1,
  refreshing: false,
  abortController: null,
  lastRefreshStartedAt: 0,
};

const number = (value) => finite(value) == null ? '—' : integer.format(Number(value));

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

function clearImageRetry(image) {
  const timer = imageRetryTimers.get(image);
  if (timer) clearTimeout(timer);
  imageRetryTimers.delete(image);
}

function installImageRetry(image) {
  if (retryImages.has(image)) return;
  retryImages.add(image);
  const loaded = () => {
    clearImageRetry(image);
    image.dataset.retryAttempt = '0';
    image.classList.add('is-loaded');
    image.hidden = false;
  };
  const failed = () => {
    image.classList.remove('is-loaded');
    image.hidden = true;
    const source = image.dataset.lastSource || '';
    const attempt = Math.max(0, Number(image.dataset.retryAttempt) || 0);
    if (!source || attempt >= IMAGE_RETRY_DELAYS.length) return;
    image.dataset.retryAttempt = String(attempt + 1);
    clearImageRetry(image);
    const timer = setTimeout(() => {
      imageRetryTimers.delete(image);
      if (image.dataset.lastSource !== source) return;
      image.removeAttribute('src');
      requestAnimationFrame(() => {
        if (image.dataset.lastSource === source) image.src = source;
      });
    }, IMAGE_RETRY_DELAYS[attempt]);
    imageRetryTimers.set(image, timer);
  };
  image.addEventListener('load', loaded);
  image.addEventListener('error', failed);
  if (image.complete && image.naturalWidth > 0) loaded();
}

function setImage(id, source, size = 200) {
  const image = byId(id);
  if (!image) return;
  const retry = id === 'trackImage';
  if (retry) installImageRetry(image);
  const next = reducedImage(source, size);
  if (!next) {
    if (retry) {
      clearImageRetry(image);
      image.dataset.lastSource = '';
      image.dataset.retryAttempt = '0';
      image.classList.remove('is-loaded');
    }
    image.hidden = true;
    image.removeAttribute('src');
    return;
  }
  if (retry && image.dataset.lastSource !== next) {
    clearImageRetry(image);
    image.dataset.lastSource = next;
    image.dataset.retryAttempt = '0';
    image.classList.remove('is-loaded');
  }
  if (image.src !== next) image.src = next;
  if (!retry) image.hidden = false;
  else if (image.complete && image.naturalWidth > 0) {
    image.classList.add('is-loaded');
    image.hidden = false;
  }
}

function inferredArtist(track) {
  for (const candidate of [track?.artist, track?.artist_name, track?.album_artist, track?.performer, track?.subtitle]) {
    const value = String(candidate || '').trim();
    if (value && !/^JP[A-Z0-9]{8,}$/i.test(value)) return value;
  }
  const display = String(track?.display_title || '').trim();
  const title = String(track?.title || '').trim();
  for (const separator of [' — ', ' – ', ' - ', ' · ', ' • ']) {
    const index = display.lastIndexOf(separator);
    if (index <= 0) continue;
    const left = display.slice(0, index).trim();
    const right = display.slice(index + separator.length).trim();
    if (!left || !right) continue;
    if (!title || left === title) return right;
    if (right === title) return left;
  }
  return '';
}

function spotifyUrl(track) {
  const value = track?.spotify_url || (track?.spotify_id ? `https://open.spotify.com/track/${track.spotify_id}` : '');
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)spotify\.com$/i.test(url.hostname) ? url.href : '';
  } catch {
    return '';
  }
}

function renderCurrentMetrics(payload) {
  const latest = payload?.latest || {};
  setImage('channelImage', latest.channel_image || latest.logo_image, 76);
  if (latest.accent_color) document.documentElement.style.setProperty('--accent', latest.accent_color);
  setText('online', number(latest.online_member_count));
  setText('members', number(latest.total_member_count));
  setText('totalStreams', number(latest.current_stream_count ?? latest.total_stream_count));
}

function renderHost() {
  const host = byId('host');
  if (!host) return;
  const handle = String(state.payload?.latest?.host_handle || '').replace(/^@/, '').trim();
  host.replaceChildren();
  if (!handle) return;
  const label = document.createElement('span');
  label.textContent = '配信ホスト ';
  const link = document.createElement('a');
  link.href = `https://stationhead.com/${encodeURIComponent(handle)}`;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = `@${handle}`;
  host.append(label, link);
}

function playbackView() {
  const queue = state.queue;
  if (!state.payload || !queue.length) return { index: -1, progress: 0, duration: 0 };
  let index = queue.findIndex((track) => track?.is_current);
  if (index < 0) index = Math.max(0, Number(state.payload.queue_status?.current_index) || 0);
  const status = state.payload.queue_status || {};
  const playing = status.playing ?? (
    state.payload.latest?.is_broadcasting !== 0
    && state.payload.latest?.is_broadcasting !== false
    && !status.is_paused
  );
  const anchor = finite(status.anchor_at);
  let progress = playing && anchor != null
    ? Math.max(0, Date.now() - anchor)
    : Math.max(0, finite(queue[index]?.progress_ms) || 0);
  while (index < queue.length - 1) {
    const duration = Math.max(0, finite(queue[index]?.duration_ms) || 0);
    if (!duration || progress < duration) break;
    progress -= duration;
    index += 1;
  }
  const duration = Math.max(0, finite(queue[index]?.duration_ms) || 0);
  return { index, progress: duration ? Math.min(progress, duration) : progress, duration };
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.floor((finite(value) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function updatePlaybackProgress(view = playbackView()) {
  const percent = view.duration > 0 ? Math.min(100, view.progress / view.duration * 100) : 0;
  setText('trackTime', `${formatDuration(view.progress)} / ${formatDuration(view.duration)}`);
  const bar = byId('trackBar');
  if (bar) bar.style.width = `${percent}%`;
}

function queueItem(track, index) {
  const link = document.createElement('a');
  link.className = 'queue-item';
  const url = spotifyUrl(track);
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
  title.textContent = track?.title || track?.display_title || track?.spotify_id || '曲名不明';
  const artist = document.createElement('small');
  artist.textContent = inferredArtist(track);
  copy.append(title, artist);
  const duration = document.createElement('span');
  duration.className = 'queue-duration';
  duration.textContent = formatDuration(track?.duration_ms);
  link.append(position, image, copy, duration);
  return link;
}

function renderQueue() {
  const box = byId('queue');
  if (!box) return;
  const current = playbackView().index;
  const upcoming = state.queue.slice(Math.max(0, current + 1));
  const returned = finite(state.payload?.queue_status?.returned_items) ?? state.queue.length;
  const total = finite(state.payload?.queue_status?.total_items) ?? returned;
  setText('queueCount', `取得 ${number(returned)}曲／登録 ${number(total)}曲`);
  box.replaceChildren(...upcoming.map((track, index) => queueItem(track, index)));
  if (!upcoming.length) {
    const empty = document.createElement('p');
    empty.className = 'subtle';
    empty.textContent = '次の曲はありません。';
    box.append(empty);
  }
}

function renderNowPlaying(force = false) {
  const view = playbackView();
  const track = view.index >= 0 ? state.queue[view.index] : null;
  if (!force && view.index === state.playbackIndex) {
    updatePlaybackProgress(view);
    return;
  }
  state.playbackIndex = view.index;
  renderHost();
  if (!track) {
    setText('trackTitle', 'キュー情報がありません');
    setText('trackArtist', '');
    setImage('trackImage', '');
    updatePlaybackProgress(view);
    renderQueue();
    return;
  }
  setText('trackTitle', track.title || track.display_title || track.spotify_id || '曲名不明');
  setText('trackArtist', inferredArtist(track));
  setImage('trackImage', track.thumbnail_url, 200);
  const bites = finite(track.bite_count);
  const biteNode = byId('trackBites');
  if (biteNode) {
    biteNode.hidden = bites == null;
    biteNode.textContent = bites == null ? '' : `♡ ${integer.format(bites)}`;
  }
  updatePlaybackProgress(view);
  renderQueue();
}

function applyPayload(payload) {
  if (!payload?.ok) return;
  state.payload = payload;
  state.queue = Array.isArray(payload.queue) ? payload.queue : [];
  state.playbackIndex = -1;
  renderCurrentMetrics(payload);
  renderNowPlaying(true);
}

function showStatus(message) {
  const node = byId('statusMessage');
  if (!node) return;
  node.textContent = message;
  node.hidden = false;
}

async function refreshDashboard(force = false) {
  const now = Date.now();
  if (
    state.refreshing
    || document.hidden
    || (!force && now - state.lastRefreshStartedAt < MIN_REFRESH_GAP_MS)
  ) return;
  state.refreshing = true;
  state.lastRefreshStartedAt = now;
  state.abortController?.abort();
  state.abortController = new AbortController();
  try {
    const response = await fetchDashboard(DASHBOARD_URL, {
      signal: state.abortController.signal,
      headers: { accept: 'application/json' },
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `dashboard API ${response.status}`);
    applyPayload(payload);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error(error);
      showStatus(state.payload ? '更新に失敗しました。保存済みの表示を継続します。' : 'データの取得に失敗しました。');
    }
  } finally {
    state.refreshing = false;
  }
}

applyPayload(window.__dashboardCurrentPayload);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) state.abortController?.abort();
  else void refreshDashboard();
});
void refreshDashboard(true);
setInterval(() => { if (!document.hidden) void refreshDashboard(); }, REFRESH_INTERVAL_MS);
setInterval(() => { if (!document.hidden) renderNowPlaying(); }, 1_000);
