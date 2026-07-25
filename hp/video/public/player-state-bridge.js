import {
  currentLandscapeLayout,
  gestureAxes,
  gestureAxisDelta
} from './gesture-layout.js';

const SOUND_ENABLED_KEY = 'video-scraper-sound-enabled';
const SOUND_VOLUME_KEY = 'video-scraper-volume';
const MODERN_TAP_THRESHOLD_PX = 28;
const LEGACY_NAVIGATION_THRESHOLD_PX = 45;

export function normalizedStoredVolume(value) {
  if (value === null || value === undefined || value === '') return 1;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
}

export function blocksLegacyTap(deltaX, deltaY) {
  const distance = Math.max(Math.abs(Number(deltaX) || 0), Math.abs(Number(deltaY) || 0));
  return distance >= MODERN_TAP_THRESHOLD_PX && distance < LEGACY_NAVIGATION_THRESHOLD_PX;
}

export function blocksLegacyPointerUp(deltaX, deltaY, nextAxis) {
  const horizontal = Number(deltaX) || 0;
  const vertical = Number(deltaY) || 0;
  const distance = Math.max(Math.abs(horizontal), Math.abs(vertical));
  if (distance < MODERN_TAP_THRESHOLD_PX) return false;
  const navigationDelta = nextAxis === 'x' ? horizontal : vertical;
  return Math.abs(navigationDelta) < LEGACY_NAVIGATION_THRESHOLD_PX;
}

function initialize() {
  const player = document.querySelector('#player');
  const videos = [...document.querySelectorAll('#player > video')];
  if (!player || !videos.length) return;

  try {
    if (localStorage.getItem(SOUND_VOLUME_KEY) === null) localStorage.setItem(SOUND_VOLUME_KEY, '1');
  } catch {}

  let pointerStart = null;

  function readSoundState() {
    try {
      return {
        enabled: localStorage.getItem(SOUND_ENABLED_KEY) === 'true',
        volume: normalizedStoredVolume(localStorage.getItem(SOUND_VOLUME_KEY))
      };
    } catch {
      return { enabled: false, volume: 1 };
    }
  }

  function applyStoredSound() {
    const state = readSoundState();
    for (const video of videos) {
      video.volume = state.volume;
      video.muted = !state.enabled || state.volume === 0;
    }
  }

  player.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('#playbackControls, #orientationFilter, #centerPlayButton')) return;
    pointerStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
  });

  player.addEventListener('pointerup', (event) => {
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
    const start = pointerStart;
    pointerStart = null;
    const landscape = currentLandscapeLayout();
    const { nextAxis } = gestureAxes(landscape);
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    const navigationDelta = gestureAxisDelta(nextAxis, start.x, start.y, event.clientX, event.clientY);
    if (blocksLegacyPointerUp(deltaX, deltaY, nextAxis) || (
      Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= MODERN_TAP_THRESHOLD_PX
      && Math.abs(navigationDelta) < LEGACY_NAVIGATION_THRESHOLD_PX
    )) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  });

  player.addEventListener('pointercancel', (event) => {
    if (pointerStart?.pointerId === event.pointerId) pointerStart = null;
  });

  for (const video of videos) {
    for (const eventName of ['play', 'playing', 'loadedmetadata', 'canplay']) {
      video.addEventListener(eventName, applyStoredSound);
    }
  }

  const observer = new MutationObserver(applyStoredSound);
  for (const video of videos) observer.observe(video, { attributes: true, attributeFilter: ['class'] });
}

if (typeof document !== 'undefined') initialize();
