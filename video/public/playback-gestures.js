import { adminFetch, clearAdminToken, ensureViewerAdminTokenPrompt, requestAdminToken } from './admin-token.js';
import { clampSeekTime } from './player-display.js';
import {
  currentLandscapeLayout,
  gestureAxes,
  gestureAxisDelta,
  seekGestureDeltaSeconds
} from './gesture-layout.js';

const SEEK_THRESHOLD_PX = 12;
const NEXT_EVENT_NAME = 'videoscraper:next';
const BLOCK_ACTION_HEADER = 'x-videoscraper-action';
const BLOCK_BUTTON_TEXT = 'NG';

export function videoSessionKey(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return String(value || '');
  }
}

async function parseJsonResponse(response) {
  return response.json().catch(() => ({}));
}

async function blockMediaUrl(mediaUrl) {
  const init = {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      [BLOCK_ACTION_HEADER]: 'block'
    },
    body: JSON.stringify({ mediaUrl })
  };

  let response = await adminFetch('/api/videos/block', init, {
    reason: 'NG登録をDBへ保存するにはADMIN_TOKENが必要です。'
  });
  let result = await parseJsonResponse(response);

  if (result.localOnly) {
    clearAdminToken();
    const token = await requestAdminToken({
      force: true,
      reason: 'ADMIN_TOKENが無効、または未設定です。再入力してください。'
    });
    if (!token) throw new Error('ADMIN_TOKEN未設定');

    response = await adminFetch('/api/videos/block', init, {
      reason: 'NG登録をDBへ保存するにはADMIN_TOKENが必要です。'
    });
    result = await parseJsonResponse(response);
  }

  if (!response.ok || !result.ok || result.localOnly) {
    throw new Error(result.error || `HTTP ${response.status}`);
  }

  return result;
}

function initialize() {
  const player = document.querySelector('#player');
  const blockButton = document.querySelector('#blockButton');
  const hint = document.querySelector('#hint');
  const videos = [...document.querySelectorAll('#player > video')];
  if (!player || !blockButton || !videos.length) return;

  const locallyBlocked = new Set();
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let seeking = false;

  const activeVideo = () => videos.find((video) => video.classList.contains('is-active')) || null;
  const isInteractive = (target) => target instanceof Element
    && Boolean(target.closest('#playbackControls, #orientationFilter, #centerPlayButton'));

  function updateHint() {
    hint.textContent = currentLandscapeLayout()
      ? '左右スワイプ: 次へ / 上下スワイプ: 時間移動 / 上下ダブルタップ: 10秒移動'
      : '上下スワイプ: 次へ / 左右スワイプ: 時間移動 / 左右ダブルタップ: 10秒移動';
  }

  function resetGesture() {
    pointerId = null;
    seeking = false;
    player.classList.remove('is-orientation-seeking');
  }

  function advanceVideo() {
    window.dispatchEvent(new CustomEvent(NEXT_EVENT_NAME, {
      detail: { direction: -1 }
    }));
  }

  player.addEventListener('pointerdown', (event) => {
    if (isInteractive(event.target)) return;
    const video = activeVideo();
    if (!video) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startTime = Number(video.currentTime) || 0;
    seeking = false;
  }, { capture: true });

  player.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    const video = activeVideo();
    if (!video) return;

    const landscape = currentLandscapeLayout();
    const { nextAxis, seekAxis } = gestureAxes(landscape);
    const seekDelta = gestureAxisDelta(seekAxis, startX, startY, event.clientX, event.clientY);
    const nextDelta = gestureAxisDelta(nextAxis, startX, startY, event.clientX, event.clientY);

    if (!seeking) {
      if (Math.abs(seekDelta) < SEEK_THRESHOLD_PX) return;
      if (Math.abs(seekDelta) <= Math.abs(nextDelta) * 1.15) return;
      seeking = true;
      player.classList.add('is-orientation-seeking');
    }

    event.preventDefault();
    event.stopPropagation();
    const seconds = seekGestureDeltaSeconds(
      event.clientX - startX,
      event.clientY - startY,
      player.clientWidth || window.innerWidth,
      player.clientHeight || window.innerHeight,
      video.duration,
      landscape
    );
    try {
      video.currentTime = clampSeekTime(startTime, seconds, video.duration);
    } catch {}
  }, { capture: true, passive: false });

  player.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointerId) return;
    if (seeking) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    resetGesture();
  }, { capture: true });

  player.addEventListener('pointercancel', (event) => {
    if (event.pointerId === pointerId) resetGesture();
  }, { capture: true });

  blockButton.addEventListener('pointerdown', (event) => event.stopPropagation());
  blockButton.addEventListener('pointerup', (event) => event.stopPropagation());
  blockButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    const video = activeVideo();
    const mediaUrl = video?.currentSrc || video?.src || player.dataset.activeMediaUrl || '';
    if (!mediaUrl || blockButton.disabled) return;

    const key = videoSessionKey(mediaUrl);
    blockButton.disabled = true;
    blockButton.textContent = '…';

    try {
      await blockMediaUrl(mediaUrl);
      locallyBlocked.add(key);
      blockButton.textContent = BLOCK_BUTTON_TEXT;
      setTimeout(() => {
        blockButton.textContent = BLOCK_BUTTON_TEXT;
        blockButton.disabled = false;
      }, 700);
      advanceVideo();
    } catch (error) {
      const message = String(error?.message || error);
      blockButton.textContent = /auth|token|unauthorized/i.test(message) ? 'AUTH' : 'ERR';
      setTimeout(() => {
        blockButton.textContent = BLOCK_BUTTON_TEXT;
        blockButton.disabled = false;
      }, 1200);
    }
  });

  for (const video of videos) {
    video.addEventListener('playing', () => {
      const key = videoSessionKey(video.currentSrc || video.src || player.dataset.activeMediaUrl);
      if (video === activeVideo() && locallyBlocked.has(key)) advanceVideo();
    });
  }

  updateHint();
  window.addEventListener('resize', updateHint);
  screen.orientation?.addEventListener?.('change', updateHint);
  void ensureViewerAdminTokenPrompt().catch(() => {});
}

if (typeof document !== 'undefined') initialize();
