import { adminFetch, ensureViewerAdminTokenPrompt, readAdminToken } from './admin-token.js';
import { createFeedSeed, shuffleFeedItems } from './feed-shuffle.js';
import { pickRandomIndexExcluding } from './playback-random.js';
import { normalizeOrientation } from './video-orientation.js';
import {
  currentLandscapeLayout,
  gestureAxes,
  gestureAxisDelta,
  hiddenTransform,
  transitionTransform
} from './gesture-layout.js';

const player = document.querySelector('#player');
const videos = [document.querySelector('#videoA'), document.querySelector('#videoB')];
const loader = document.querySelector('#loader');
const message = document.querySelector('#message');
const hint = document.querySelector('#hint');
const orientationFilter = document.querySelector('#orientationFilter');
const orientationButtons = [...orientationFilter.querySelectorAll('[data-orientation]')];

const LOAD_TIMEOUT_MS = 8000;
const MAX_SKIP_ATTEMPTS = 12;
const LAST_FIRST_VIDEO_KEY = 'video-scraper-last-first-video-id';
const ORIENTATION_KEY = 'video-scraper-orientation';
const NEXT_EVENT_NAME = 'videoscraper:next';
const ADMIN_TOKEN_CHANGE_EVENT = 'videoscraper:admin-token-change';
const FEED_PAGE_SIZE = 100;
const INITIAL_FEED_SIZE = 2000;
const ORIENTED_INITIAL_FEED_SIZE = 2000;
const MAX_FEED_PAGES = 20;

function setMessage(text = '') {
  message.textContent = text;
  message.hidden = !text;
}

function setLoading(active) {
  loader.hidden = !active;
}

function playbackFailureMessage() {
  return 'この動画は再生できません。BAD登録またはスワイプで次へ進めます';
}

function readOrientationPreference() {
  try {
    return normalizeOrientation(localStorage.getItem(ORIENTATION_KEY));
  } catch {
    return 'both';
  }
}

const state = {
  seed: 1,
  items: [],
  activeSlot: 0,
  activeIndex: -1,
  slotIndexes: [-1, -1],
  slotPromises: [null, null],
  slotTokens: [0, 0],
  failedIndexes: new Set(),
  muted: true,
  moving: false,
  pointerStart: null,
  orientation: readOrientationPreference(),
  feedGeneration: 0
};

function readLastFirstVideoId() {
  try {
    return localStorage.getItem(`${LAST_FIRST_VIDEO_KEY}:${state.orientation}`);
  } catch {
    return null;
  }
}

function rememberFirstVideoId(id) {
  try {
    localStorage.setItem(`${LAST_FIRST_VIDEO_KEY}:${state.orientation}`, String(id));
  } catch {}
}

function rememberOrientation() {
  try {
    localStorage.setItem(ORIENTATION_KEY, state.orientation);
  } catch {}
}

function updateOrientationControls() {
  for (const button of orientationButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.orientation === state.orientation));
  }
}

function setActiveItem(index) {
  state.activeIndex = index;
  const item = state.items[index] || null;
  player.dataset.activeMediaUrl = item?.mediaUrl || '';
  player.dataset.activeVideoId = item?.id === undefined ? '' : String(item.id);
}

function clearActiveItem() {
  state.activeIndex = -1;
  player.dataset.activeMediaUrl = '';
  player.dataset.activeVideoId = '';
}

function orientationEmptyMessage() {
  if (state.orientation === 'vertical') return '縦動画が見つかりません';
  if (state.orientation === 'horizontal') return '横動画が見つかりません';
  return '動画がまだありません';
}

async function fetchFeed(generation, seed) {
  const targetSize = state.orientation === 'both'
    ? INITIAL_FEED_SIZE
    : ORIENTED_INITIAL_FEED_SIZE;
  const matches = [];
  let cursor = 'start';
  let pages = 0;

  while (matches.length < targetSize && pages < MAX_FEED_PAGES) {
    if (generation !== state.feedGeneration) return [];
    const params = new URLSearchParams({
      seed: String(seed),
      cursor: cursor || 'start',
      limit: String(FEED_PAGE_SIZE),
      orientation: state.orientation
    });
    const response = await adminFetch(`/api/videos?${params}`, {
      cache: 'no-store',
      credentials: 'same-origin'
    }, {
      reason: '動画を表示するにはADMIN_TOKENが必要です。'
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.items)) throw new Error('動画一覧を読み込めませんでした');

    for (const item of data.items) {
      matches.push(item);
      if (matches.length >= targetSize) break;
    }
    pages += 1;
    cursor = typeof data.nextCursor === 'string' && data.nextCursor
      ? data.nextCursor
      : null;
    if (!cursor) break;
  }

  if (!matches.length) throw new Error(orientationEmptyMessage());
  return matches.slice(0, targetSize);
}

function resetSlot(slot) {
  state.slotTokens[slot] += 1;
  state.slotPromises[slot] = null;
  state.slotIndexes[slot] = -1;
  const video = videos[slot];
  video.pause();
  video.classList.remove('is-active', 'is-moving');
  video.style.transform = hiddenTransform(currentLandscapeLayout());
  video.removeAttribute('src');
  video.load();
}

function resetPlaybackForMissingAuth() {
  state.feedGeneration += 1;
  state.items = [];
  state.failedIndexes.clear();
  state.moving = false;
  clearActiveItem();
  resetSlot(0);
  resetSlot(1);
  setLoading(false);
  setMessage('');
}

async function ensurePlaybackAuth() {
  const token = readAdminToken() || await ensureViewerAdminTokenPrompt();
  if (token) return true;
  resetPlaybackForMissingAuth();
  return false;
}

function waitForVideo(video, url, token, slot) {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('error', onError);
      video.removeEventListener('abort', onError);
    };
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ok && token === state.slotTokens[slot]);
    };
    const onReady = () => finish(true);
    const onError = () => finish(false);
    const timer = setTimeout(() => {
      finish(video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !video.error);
    }, LOAD_TIMEOUT_MS);

    video.addEventListener('loadeddata', onReady, { once: true });
    video.addEventListener('canplay', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.addEventListener('abort', onError, { once: true });
    video.preload = 'auto';
    video.muted = state.muted;
    video.src = url;
    video.load();
  });
}

async function loadSlot(slot, index) {
  if (!state.items.length) return false;
  const normalizedIndex = ((index % state.items.length) + state.items.length) % state.items.length;
  const video = videos[slot];
  if (state.failedIndexes.has(normalizedIndex)) return false;
  if (state.slotIndexes[slot] === normalizedIndex && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !video.error) return true;
  if (state.slotIndexes[slot] === normalizedIndex && state.slotPromises[slot]) return state.slotPromises[slot];

  resetSlot(slot);
  const token = state.slotTokens[slot];
  state.slotIndexes[slot] = normalizedIndex;
  const promise = waitForVideo(video, state.items[normalizedIndex].mediaUrl, token, slot)
    .then((ok) => {
      if (ok) state.failedIndexes.delete(normalizedIndex);
      else if (token === state.slotTokens[slot]) {
        state.failedIndexes.add(normalizedIndex);
        resetSlot(slot);
      }
      return ok;
    })
    .finally(() => {
      if (token === state.slotTokens[slot]) state.slotPromises[slot] = null;
    });
  state.slotPromises[slot] = promise;
  return promise;
}

function prepareFailedSlot(slot, index) {
  if (!state.items.length || index === null) return null;
  const normalizedIndex = ((index % state.items.length) + state.items.length) % state.items.length;
  resetSlot(slot);
  const video = videos[slot];
  state.slotIndexes[slot] = normalizedIndex;
  video.preload = 'metadata';
  video.muted = state.muted;
  video.src = state.items[normalizedIndex].mediaUrl;
  video.load();
  return normalizedIndex;
}

async function findPlayable(slot, startIndex, excludedIndex = -1) {
  const attempts = Math.min(MAX_SKIP_ATTEMPTS, state.items.length);
  let lastFailedIndex = null;
  for (let offset = 0; offset < attempts; offset += 1) {
    const index = (startIndex + offset) % state.items.length;
    if (index === excludedIndex) continue;
    lastFailedIndex = index;
    if (state.failedIndexes.has(index)) continue;
    if (await loadSlot(slot, index)) return { index, playable: true };
  }
  return { index: lastFailedIndex, playable: false };
}

async function startVideo(video) {
  video.muted = state.muted;
  try {
    await video.play();
    return true;
  } catch {
    return false;
  }
}

function activateSlot(slot, index) {
  state.activeSlot = slot;
  setActiveItem(index);
  const video = videos[slot];
  video.style.transform = 'translate(0, 0)';
  video.classList.add('is-active');
}

function preloadNext() {
  if (!state.items.length || state.activeIndex < 0) return;
  const nextSlot = 1 - state.activeSlot;
  const startIndex = pickRandomIndexExcluding(state.items.length, state.activeIndex);
  findPlayable(nextSlot, startIndex, state.activeIndex).catch(() => {});
}

async function showFirst() {
  if (!await ensurePlaybackAuth()) return;
  const generation = state.feedGeneration + 1;
  const seed = createFeedSeed();
  state.feedGeneration = generation;
  state.seed = seed;
  state.moving = true;
  state.items = [];
  state.failedIndexes.clear();
  clearActiveItem();
  resetSlot(0);
  resetSlot(1);
  setLoading(true);
  setMessage('');
  try {
    const items = await fetchFeed(generation, seed);
    if (generation !== state.feedGeneration) return;
    state.items = shuffleFeedItems(
      items,
      seed,
      readLastFirstVideoId(),
      MAX_SKIP_ATTEMPTS
    );
    const result = await findPlayable(0, 0);
    if (generation !== state.feedGeneration) return;
    if (result.index === null) throw new Error('再生候補がありません');
    if (!result.playable) prepareFailedSlot(0, result.index);
    activateSlot(0, result.index);
    rememberFirstVideoId(state.items[result.index].id);
    setLoading(false);
    if (result.playable) {
      if (!await startVideo(videos[0])) setMessage(playbackFailureMessage());
    } else {
      setMessage(playbackFailureMessage());
    }
    preloadNext();
  } catch (error) {
    if (generation === state.feedGeneration) {
      setLoading(false);
      setMessage(error.message || '動画を読み込めませんでした');
    }
  } finally {
    if (generation === state.feedGeneration) state.moving = false;
  }
}

async function nextVideo(direction = -1) {
  if (!readAdminToken()) {
    resetPlaybackForMissingAuth();
    return;
  }
  if (state.moving || !state.items.length) return;
  state.moving = true;
  hint.classList.add('is-hidden');
  setMessage('');
  const currentSlot = state.activeSlot;
  const nextSlot = 1 - currentSlot;
  const current = videos[currentSlot];
  const incoming = videos[nextSlot];
  const landscape = currentLandscapeLayout();
  try {
    setLoading(true);
    const preloadedIndex = state.slotIndexes[nextSlot];
    const startIndex = preloadedIndex >= 0 && preloadedIndex !== state.activeIndex
      ? preloadedIndex
      : pickRandomIndexExcluding(state.items.length, state.activeIndex);
    const result = await findPlayable(nextSlot, startIndex, state.activeIndex);
    if (result.index === null) {
      setMessage('次の再生候補がありません');
      return;
    }
    if (!result.playable) prepareFailedSlot(nextSlot, result.index);
    incoming.style.transform = transitionTransform(landscape, direction, true);
    incoming.classList.add('is-moving');
    current.classList.add('is-moving');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      incoming.style.transform = 'translate(0, 0)';
      current.style.transform = transitionTransform(landscape, direction, false);
    }));
    await new Promise((resolve) => setTimeout(resolve, 190));
    current.pause();
    current.classList.remove('is-active', 'is-moving');
    incoming.classList.remove('is-moving');
    incoming.classList.add('is-active');
    state.activeSlot = nextSlot;
    setActiveItem(result.index);
    setLoading(false);
    if (result.playable) {
      if (!await startVideo(incoming)) setMessage(playbackFailureMessage());
    } else {
      setMessage(playbackFailureMessage());
    }
    resetSlot(currentSlot);
    preloadNext();
  } finally {
    setLoading(false);
    state.moving = false;
  }
}

function toggleSoundOrPlay() {
  if (!readAdminToken()) return;
  if (state.activeIndex < 0) return;
  const video = videos[state.activeSlot];
  if (video.paused) {
    video.play().then(() => setMessage('')).catch(() => setMessage(playbackFailureMessage()));
    return;
  }
  state.muted = !state.muted;
  for (const item of videos) item.muted = state.muted;
}

function selectOrientation(value) {
  const orientation = normalizeOrientation(value);
  if (orientation === state.orientation) return;
  state.orientation = orientation;
  rememberOrientation();
  updateOrientationControls();
  showFirst().catch(() => {});
}

function refreshInactiveTransforms() {
  const landscape = currentLandscapeLayout();
  videos.forEach((video, slot) => {
    if (slot !== state.activeSlot || !video.classList.contains('is-active')) {
      video.style.transform = hiddenTransform(landscape);
    }
  });
}

orientationFilter.addEventListener('pointerdown', (event) => event.stopPropagation());
orientationFilter.addEventListener('pointerup', (event) => event.stopPropagation());
orientationFilter.addEventListener('click', (event) => {
  event.stopPropagation();
  const button = event.target.closest('[data-orientation]');
  if (button) selectOrientation(button.dataset.orientation);
});

player.addEventListener('pointerdown', (event) => {
  state.pointerStart = { x: event.clientX, y: event.clientY };
  player.setPointerCapture?.(event.pointerId);
});

player.addEventListener('pointerup', (event) => {
  if (!state.pointerStart) return;
  const landscape = currentLandscapeLayout();
  const { nextAxis } = gestureAxes(landscape);
  const delta = gestureAxisDelta(nextAxis, state.pointerStart.x, state.pointerStart.y, event.clientX, event.clientY);
  state.pointerStart = null;
  if (Math.abs(delta) >= 45) nextVideo(delta).catch(() => {});
  else toggleSoundOrPlay();
});

player.addEventListener('pointercancel', () => {
  state.pointerStart = null;
});

window.addEventListener('keydown', (event) => {
  if (event.target instanceof Element && event.target.closest('#orientationFilter')) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === ' ') {
    event.preventDefault();
    nextVideo(event.key === 'ArrowUp' ? 1 : -1).catch(() => {});
  }
});

window.addEventListener(NEXT_EVENT_NAME, (event) => {
  nextVideo(Number(event.detail?.direction) || -1).catch(() => {});
});

window.addEventListener(ADMIN_TOKEN_CHANGE_EVENT, (event) => {
  if (!event.detail?.stored) {
    resetPlaybackForMissingAuth();
    return;
  }
  if (!state.items.length && !state.moving) showFirst().catch(() => {});
});

window.addEventListener('resize', refreshInactiveTransforms);
screen.orientation?.addEventListener?.('change', refreshInactiveTransforms);

videos.forEach((video, slot) => {
  video.addEventListener('waiting', () => {
    if (slot === state.activeSlot) setLoading(true);
  });
  video.addEventListener('playing', () => {
    if (slot === state.activeSlot) {
      setLoading(false);
      setMessage('');
    }
  });
  video.addEventListener('ended', () => {
    if (slot === state.activeSlot && !state.moving) nextVideo(-1).catch(() => {});
  });
  video.addEventListener('error', () => {
    if (slot === state.activeSlot && state.activeIndex >= 0 && !state.moving) {
      state.failedIndexes.add(state.activeIndex);
      setLoading(false);
      setMessage(playbackFailureMessage());
    }
  });
});

updateOrientationControls();
showFirst().catch(() => {});
