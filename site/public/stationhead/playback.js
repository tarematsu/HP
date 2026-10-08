// Artwork, queue progression and current metric presentation.
import { finiteNumber as finite } from '../dashboard-ui-common.js?v=20261004.1';
import { role, setText, numberText, reducedImage, trackArtist, durationText } from './view-utils.js';
import { renderCurrentChart } from './current-chart.js';

function resetArtwork(image) {
  image.onload = null; image.onerror = null; image.removeAttribute('src'); image.removeAttribute('data-artwork-source'); image.classList.remove('is-loaded'); image.hidden = true;
}

function setArtwork(image, source) {
  if (!image) return;
  const next = reducedImage(source); if (!next) { resetArtwork(image); return; }
  if (image.dataset.artworkSource === next && image.classList.contains('is-loaded')) return;
  image.dataset.artworkSource = next; image.hidden = true; image.classList.remove('is-loaded');
  image.onload = () => { if (image.dataset.artworkSource !== next) return; image.classList.add('is-loaded'); image.hidden = false; };
  image.onerror = () => { if (image.dataset.artworkSource === next) resetArtwork(image); };
  image.src = next;
  if (image.complete && image.naturalWidth > 0) image.onload();
}

export function playbackView(runtime) {
  const payload = runtime.current || {}; const queue = Array.isArray(payload.queue) ? payload.queue : [];
  let index = queue.findIndex((track) => track?.is_current); if (index < 0) index = Math.max(0, Number(payload?.queue_status?.current_index) || 0);
  const status = payload.queue_status || {}; const anchor = finite(status.anchor_at); const playing = status.playing ?? !status.is_paused;
  let progress = playing && anchor != null ? Math.max(0, Date.now() - anchor) : Math.max(0, finite(queue[index]?.progress_ms) || 0);
  while (index >= 0 && index < queue.length - 1) { const duration = Math.max(0, finite(queue[index]?.duration_ms) || 0); if (!duration || progress < duration) break; progress -= duration; index += 1; }
  const duration = index >= 0 ? Math.max(0, finite(queue[index]?.duration_ms) || 0) : 0;
  return { queue, index: queue.length ? index : -1, progress: duration ? Math.min(progress, duration) : progress, duration };
}

export function renderPlayback(runtime, force = false) {
  const { root, model } = runtime; const view = playbackView(runtime); const track = view.index >= 0 ? view.queue[view.index] : null;
  const link = role(root, 'station-link'); if (link) link.href = model.meta.station_url;
  const host = role(root, 'host'); if (host) { host.replaceChildren(); const handle = String(runtime.current?.latest?.host_handle || '').replace(/^@/, '').trim(); if (handle) { const anchor = document.createElement('a'); anchor.href = `https://stationhead.com/${encodeURIComponent(handle)}`; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; anchor.textContent = `@${handle}`; host.append('配信ホスト ', anchor); } }
  setText(root, 'track-title', track ? (track.title || track.display_title || track.spotify_id || '曲名不明') : 'キュー情報がありません'); setText(root, 'track-artist', track ? trackArtist(track) : '');
  setArtwork(role(root, 'track-image'), track?.thumbnail_url);
  setText(root, 'track-time', `${durationText(view.progress)} / ${durationText(view.duration)}`); const bar = role(root, 'track-bar'); if (bar) bar.style.width = `${view.duration ? Math.min(100, view.progress / view.duration * 100) : 0}%`;
  const bites = role(root, 'track-bites'); if (bites) { const value = finite(track?.bite_count); bites.hidden = value == null; bites.textContent = value == null ? '' : `♡ ${numberText(value)}`; }
  if (!force && runtime.playbackIndex === view.index) return; runtime.playbackIndex = view.index;
  const box = role(root, 'queue'); if (!box) return; const upcoming = view.queue.slice(Math.max(0, view.index + 1), Math.max(0, view.index + 1) + 8); box.replaceChildren();
  setText(root, 'queue-count', `取得 ${numberText(runtime.current?.queue_status?.returned_items ?? view.queue.length)}曲／登録 ${numberText(runtime.current?.queue_status?.total_items ?? view.queue.length)}曲`);
  for (const [index, item] of upcoming.entries()) {
    const anchor = document.createElement('a'); anchor.className = 'queue-item'; const spotify = item?.spotify_url || (item?.spotify_id ? `https://open.spotify.com/track/${item.spotify_id}` : ''); anchor.href = spotify || '#';
    if (spotify) { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; } else anchor.addEventListener('click', (event) => event.preventDefault());
    const number = document.createElement('span'); number.className = 'queue-index'; number.textContent = String(index + 1);
    const image = document.createElement('img'); image.className = 'queue-thumb'; image.width = 42; image.height = 42; image.alt = ''; image.loading = 'lazy'; const source = reducedImage(item?.thumbnail_url); if (source) { image.src = source; image.addEventListener('error', () => { image.hidden = true; }, { once: true }); } else image.hidden = true;
    const copy = document.createElement('span'); copy.className = 'queue-copy'; const strong = document.createElement('strong'); strong.textContent = item?.title || item?.display_title || item?.spotify_id || '曲名不明'; const small = document.createElement('small'); small.textContent = trackArtist(item); copy.append(strong, small);
    const duration = document.createElement('span'); duration.className = 'queue-duration'; duration.textContent = durationText(item?.duration_ms); anchor.append(number, image, copy, duration); box.append(anchor);
  }
  if (!upcoming.length) { const empty = document.createElement('p'); empty.className = 'subtle'; empty.textContent = '次の曲はありません。'; box.append(empty); }
}

export function renderCurrent(runtime, payload) {
  runtime.current = payload; runtime.playbackIndex = -1; setText(runtime.root, 'online', numberText(payload?.latest?.online_member_count)); setText(runtime.root, 'streams', numberText(payload?.latest?.total_stream_count)); setText(runtime.root, 'members', numberText(payload?.latest?.total_member_count)); renderCurrentChart(runtime, payload); renderPlayback(runtime, true);
}
