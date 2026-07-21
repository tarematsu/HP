import { normalizedStoredVolume } from './player-state-bridge.js';

const SOUND_ENABLED_KEY = 'video-scraper-sound-enabled';
const SOUND_VOLUME_KEY = 'video-scraper-volume';

function readStoredState() {
  try {
    return {
      enabled: localStorage.getItem(SOUND_ENABLED_KEY) === 'true',
      volume: normalizedStoredVolume(localStorage.getItem(SOUND_VOLUME_KEY))
    };
  } catch {
    return { enabled: false, volume: 1 };
  }
}

function initialize() {
  const player = document.querySelector('#player');
  const videos = [...document.querySelectorAll('#player > video')];
  if (!player || !videos.length) return;

  let activated = Boolean(navigator.userActivation?.hasBeenActive);

  function applyStoredSound() {
    if (!activated) return;
    const state = readStoredState();
    for (const video of videos) {
      video.volume = state.volume;
      video.muted = !state.enabled || state.volume === 0;
    }
  }

  window.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('#player')) return;
    activated = true;
    if (event.target.closest('#muteButton, #volumeBar')) return;
    applyStoredSound();
  }, { capture: true });

  window.addEventListener('keydown', () => {
    activated = true;
    applyStoredSound();
  }, { capture: true, once: true });

  window.addEventListener('storage', (event) => {
    if (event.key === SOUND_ENABLED_KEY || event.key === SOUND_VOLUME_KEY) applyStoredSound();
  });

  for (const video of videos) {
    for (const eventName of ['canplay', 'loadedmetadata']) {
      video.addEventListener(eventName, applyStoredSound);
    }
  }

  applyStoredSound();
}

if (typeof document !== 'undefined') initialize();
