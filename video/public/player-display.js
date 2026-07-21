import { currentLandscapeLayout } from './gesture-layout.js';
import { normalizedStoredVolume } from './player-state-bridge.js';
import { inferVideoOrientation } from './video-orientation.js';

const SOUND_ENABLED_KEY = 'video-scraper-sound-enabled';
const SOUND_VOLUME_KEY = 'video-scraper-volume';
const TAP_THRESHOLD_PX = 28;
const DOUBLE_TAP_DELAY_MS = 280;
const CONTROL_HIDE_DELAY_MS = 2600;

export function formatMediaTime(value) {
  const seconds = Number.isFinite(Number(value)) && Number(value) > 0
    ? Math.floor(Number(value))
    : 0;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function clampSeekTime(currentTime, delta, duration) {
  const current = Number.isFinite(Number(currentTime)) ? Number(currentTime) : 0;
  const change = Number.isFinite(Number(delta)) ? Number(delta) : 0;
  const maximum = Number.isFinite(Number(duration)) && Number(duration) > 0
    ? Number(duration)
    : Math.max(0, current + change);
  return Math.min(maximum, Math.max(0, current + change));
}

export function orientationLockForVideo(videoWidth, videoHeight, mediaUrl = '') {
  const width = Number(videoWidth);
  const height = Number(videoHeight);
  if (width > 0 && height > 0) {
    if (height > width) return 'portrait-primary';
    if (width > height) return 'landscape-primary';
    return null;
  }

  const inferred = inferVideoOrientation(mediaUrl);
  if (inferred === 'vertical') return 'portrait-primary';
  if (inferred === 'horizontal') return 'landscape-primary';
  return null;
}

export function doubleTapSeekSeconds(
  clientX,
  width,
  clientY = 0,
  height = 0,
  landscape = false
) {
  const position = Number(landscape ? clientY : clientX);
  const span = Number(landscape ? height : width);
  if (!Number.isFinite(position) || !Number.isFinite(span) || span <= 0) return 0;
  const fraction = position / span;
  if (fraction < 0.4) return -10;
  if (fraction > 0.6) return 10;
  return 0;
}

function isInstalledDisplayMode() {
  return ['fullscreen', 'standalone', 'minimal-ui'].some((mode) => {
    try {
      return window.matchMedia(`(display-mode: ${mode})`).matches;
    } catch {
      return false;
    }
  });
}

function readStoredVolume() {
  try {
    return normalizedStoredVolume(localStorage.getItem(SOUND_VOLUME_KEY));
  } catch {
    return 1;
  }
}

function readStoredSoundEnabled() {
  try {
    return localStorage.getItem(SOUND_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredSoundState(enabled, volume) {
  try {
    localStorage.setItem(SOUND_ENABLED_KEY, String(Boolean(enabled)));
    localStorage.setItem(SOUND_VOLUME_KEY, String(Math.min(1, Math.max(0, Number(volume) || 0))));
  } catch {}
}

function initialize() {
  const player = document.querySelector('#player');
  const videos = [...document.querySelectorAll('#player > video')];
  const controls = document.querySelector('#playbackControls');
  const seekBar = document.querySelector('#seekBar');
  const currentLabel = document.querySelector('#currentTime');
  const durationLabel = document.querySelector('#durationTime');
  const playPauseButton = document.querySelector('#playPauseButton');
  const centerPlayButton = document.querySelector('#centerPlayButton');
  const muteButton = document.querySelector('#muteButton');
  const volumeBar = document.querySelector('#volumeBar');
  const fullscreenButton = document.querySelector('#fullscreenButton');
  const tapFeedback = document.querySelector('#tapFeedback');
  const skipButtons = [...document.querySelectorAll('[data-skip-seconds]')];

  if (
    !player
    || !videos.length
    || !controls
    || !seekBar
    || !currentLabel
    || !durationLabel
    || !playPauseButton
    || !centerPlayButton
    || !muteButton
    || !volumeBar
    || !fullscreenButton
    || !tapFeedback
  ) return;

  let scrubbing = false;
  let fullscreenRequest = null;
  let lastOrientationLock = null;
  let hideTimer = null;
  let singleTapTimer = null;
  let feedbackTimer = null;
  let pointerStart = null;
  let lastTap = null;
  let syncingVolume = false;

  const activeVideo = () => videos.find((video) => video.classList.contains('is-active')) || null;
  const isInteractive = (target) => target instanceof Element
    && Boolean(target.closest('#playbackControls, #orientationFilter, #centerPlayButton'));

  function clearHideTimer() {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
  }

  function setControlsVisible(visible) {
    player.classList.toggle('controls-hidden', !visible);
    player.dataset.controlsVisible = String(visible);
    controls.setAttribute('aria-hidden', String(!visible));
  }

  function scheduleControlsHide() {
    clearHideTimer();
    const video = activeVideo();
    if (!video || video.paused || scrubbing) return;
    hideTimer = setTimeout(() => setControlsVisible(false), CONTROL_HIDE_DELAY_MS);
  }

  function showControls() {
    setControlsVisible(true);
    scheduleControlsHide();
  }

  function toggleControls() {
    const visible = player.dataset.controlsVisible !== 'false';
    setControlsVisible(!visible);
    if (!visible) scheduleControlsHide();
    else clearHideTimer();
  }

  function updateFullscreenButton() {
    const fullscreen = Boolean(document.fullscreenElement);
    fullscreenButton.setAttribute('aria-label', fullscreen ? '全画面表示を終了' : '全画面表示');
    fullscreenButton.querySelector('span').textContent = fullscreen ? '⤡' : '⛶';
  }

  function updatePlayState() {
    const video = activeVideo();
    const paused = !video || video.paused || video.ended;
    player.classList.toggle('is-paused', paused);
    playPauseButton.setAttribute('aria-label', paused ? '再生' : '一時停止');
    playPauseButton.querySelector('span').textContent = paused ? '▶' : '❚❚';
    centerPlayButton.setAttribute('aria-label', paused ? '再生' : '一時停止');
    centerPlayButton.querySelector('span').textContent = paused ? '▶' : '❚❚';
    if (paused) {
      clearHideTimer();
      setControlsVisible(true);
    } else {
      scheduleControlsHide();
    }
  }

  function bufferedPercent(video, duration) {
    if (!video || !Number.isFinite(duration) || duration <= 0 || !video.buffered?.length) return 0;
    let end = 0;
    for (let index = 0; index < video.buffered.length; index += 1) {
      end = Math.max(end, Number(video.buffered.end(index)) || 0);
    }
    return Math.min(100, Math.max(0, (end / duration) * 100));
  }

  function updateTimeline() {
    const video = activeVideo();
    const duration = Number(video?.duration);
    const current = Number(video?.currentTime);
    const playable = Boolean(video && Number.isFinite(duration) && duration > 0);
    const fraction = playable ? Math.min(1, Math.max(0, current / duration)) : 0;

    seekBar.disabled = !playable;
    if (!scrubbing) seekBar.value = String(Math.round(fraction * 1000));
    currentLabel.textContent = formatMediaTime(current);
    durationLabel.textContent = formatMediaTime(duration);
    seekBar.setAttribute('aria-valuetext', `${formatMediaTime(current)} / ${formatMediaTime(duration)}`);
    controls.style.setProperty('--seek-percent', `${fraction * 100}%`);
    controls.style.setProperty('--buffered-percent', `${Math.max(fraction * 100, bufferedPercent(video, duration))}%`);
  }

  function updateVolumeUI() {
    const video = activeVideo() || videos[0];
    const volume = Math.min(1, Math.max(0, Number(video?.volume) || 0));
    const muted = Boolean(video?.muted) || volume === 0;
    volumeBar.value = String(Math.round(volume * 100));
    muteButton.setAttribute('aria-label', muted ? 'ミュート解除' : 'ミュート');
    muteButton.querySelector('span').textContent = muted ? '🔇' : volume < 0.5 ? '🔉' : '🔊';
  }

  function applySoundState(volume, muted) {
    const normalized = Math.min(1, Math.max(0, Number(volume) || 0));
    syncingVolume = true;
    for (const video of videos) {
      video.volume = normalized;
      video.muted = Boolean(muted) || normalized === 0;
    }
    syncingVolume = false;
    writeStoredSoundState(!muted && normalized > 0, normalized);
    updateVolumeUI();
  }

  async function lockToActiveVideo() {
    const video = activeVideo();
    const orientation = video
      ? orientationLockForVideo(video.videoWidth, video.videoHeight, video.currentSrc || video.src)
      : null;
    const fullscreenLike = Boolean(document.fullscreenElement) || isInstalledDisplayMode();

    if (!fullscreenLike) {
      lastOrientationLock = null;
      return false;
    }
    if (!screen.orientation?.lock) return false;
    if (!orientation) {
      if (lastOrientationLock && screen.orientation?.unlock) {
        try {
          screen.orientation.unlock();
        } catch {}
      }
      lastOrientationLock = null;
      return false;
    }
    if (orientation === lastOrientationLock) return true;

    try {
      await screen.orientation.lock(orientation);
      lastOrientationLock = orientation;
      return true;
    } catch {
      return false;
    }
  }

  async function enterFullscreen() {
    if (!document.fullscreenElement && player.requestFullscreen) {
      if (!fullscreenRequest) {
        fullscreenRequest = player.requestFullscreen()
          .catch(() => false)
          .finally(() => {
            fullscreenRequest = null;
          });
      }
      await fullscreenRequest;
    }
    updateFullscreenButton();
    await lockToActiveVideo();
    return Boolean(document.fullscreenElement);
  }

  async function exitFullscreen() {
    lastOrientationLock = null;
    if (screen.orientation?.unlock) {
      try {
        screen.orientation.unlock();
      } catch {}
    }
    if (document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen().catch(() => false);
    }
    updateFullscreenButton();
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await exitFullscreen();
    else await enterFullscreen();
    showControls();
  }

  function seekFromBar() {
    const video = activeVideo();
    const duration = Number(video?.duration);
    if (!video || !Number.isFinite(duration) || duration <= 0) return;
    const fraction = Math.min(1000, Math.max(0, Number(seekBar.value) || 0)) / 1000;
    try {
      video.currentTime = duration * fraction;
    } catch {
      return;
    }
    currentLabel.textContent = formatMediaTime(video.currentTime);
    controls.style.setProperty('--seek-percent', `${fraction * 100}%`);
  }

  function showFeedback(text, side = 'center') {
    if (feedbackTimer) clearTimeout(feedbackTimer);
    tapFeedback.textContent = text;
    tapFeedback.dataset.side = side;
    tapFeedback.hidden = false;
    feedbackTimer = setTimeout(() => {
      tapFeedback.hidden = true;
    }, 430);
  }

  function skip(seconds, feedback = false) {
    const video = activeVideo();
    if (!video) return;
    try {
      video.currentTime = clampSeekTime(video.currentTime, seconds, video.duration);
    } catch {
      return;
    }
    updateTimeline();
    showControls();
    if (feedback) showFeedback(seconds < 0 ? '↶ 10秒' : '10秒 ↷', seconds < 0 ? 'left' : 'right');
  }

  async function togglePlayback() {
    const video = activeVideo();
    if (!video) return;
    if (video.paused || video.ended) {
      await video.play().catch(() => false);
    } else {
      video.pause();
    }
    updatePlayState();
    showControls();
  }

  function restorePreferredSound() {
    if (!readStoredSoundEnabled()) return;
    const volume = readStoredVolume();
    syncingVolume = true;
    for (const video of videos) {
      video.volume = volume;
      video.muted = volume === 0;
    }
    syncingVolume = false;
    updateVolumeUI();
  }

  function toggleMute() {
    const video = activeVideo() || videos[0];
    if (!video) return;
    const volume = video.volume > 0 ? video.volume : readStoredVolume() || 1;
    applySoundState(volume, !video.muted);
    showControls();
  }

  function handleTap(event) {
    const now = performance.now();
    const landscape = currentLandscapeLayout();
    const sideSeconds = doubleTapSeekSeconds(
      event.clientX,
      player.clientWidth || window.innerWidth,
      event.clientY,
      player.clientHeight || window.innerHeight,
      landscape
    );
    const side = sideSeconds < 0
      ? (landscape ? 'top' : 'left')
      : sideSeconds > 0
        ? (landscape ? 'bottom' : 'right')
        : 'center';
    const repeat = lastTap
      && now - lastTap.time <= DOUBLE_TAP_DELAY_MS
      && lastTap.side === side;

    if (repeat) {
      if (singleTapTimer) clearTimeout(singleTapTimer);
      singleTapTimer = null;
      lastTap = null;
      if (sideSeconds) {
        skip(sideSeconds);
        showFeedback(sideSeconds < 0 ? '↶ 10秒' : '10秒 ↷', side);
      } else {
        void togglePlayback();
      }
      return;
    }

    lastTap = { time: now, side };
    if (singleTapTimer) clearTimeout(singleTapTimer);
    singleTapTimer = setTimeout(() => {
      singleTapTimer = null;
      lastTap = null;
      toggleControls();
    }, DOUBLE_TAP_DELAY_MS);
  }

  function handleKeyboard(event) {
    if (event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    if (key === ' ' || key === 'k') {
      event.preventDefault();
      event.stopImmediatePropagation();
      restorePreferredSound();
      void togglePlayback();
    } else if (key === 'm') {
      event.preventDefault();
      toggleMute();
    } else if (key === 'f') {
      event.preventDefault();
      void toggleFullscreen();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      skip(-5);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      skip(5);
    } else if (key === 'j') {
      event.preventDefault();
      skip(-10);
    } else if (key === 'l') {
      event.preventDefault();
      skip(10);
    } else if (event.key === 'Home') {
      event.preventDefault();
      const video = activeVideo();
      if (video) video.currentTime = 0;
    } else if (event.key === 'End') {
      event.preventDefault();
      const video = activeVideo();
      if (video && Number.isFinite(video.duration)) video.currentTime = video.duration;
    }
  }

  controls.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    showControls();
  });
  controls.addEventListener('pointerup', (event) => event.stopPropagation());
  controls.addEventListener('click', (event) => event.stopPropagation());

  playPauseButton.addEventListener('click', () => void togglePlayback());
  centerPlayButton.addEventListener('pointerdown', (event) => event.stopPropagation());
  centerPlayButton.addEventListener('pointerup', (event) => event.stopPropagation());
  centerPlayButton.addEventListener('click', (event) => {
    event.stopPropagation();
    void togglePlayback();
  });
  muteButton.addEventListener('click', toggleMute);
  fullscreenButton.addEventListener('click', () => void toggleFullscreen());

  seekBar.addEventListener('pointerdown', () => {
    scrubbing = true;
    clearHideTimer();
  });
  seekBar.addEventListener('input', seekFromBar);
  seekBar.addEventListener('change', () => {
    seekFromBar();
    scrubbing = false;
    updateTimeline();
    scheduleControlsHide();
  });
  seekBar.addEventListener('pointerup', () => {
    scrubbing = false;
    updateTimeline();
    scheduleControlsHide();
  });
  seekBar.addEventListener('pointercancel', () => {
    scrubbing = false;
    updateTimeline();
    scheduleControlsHide();
  });

  volumeBar.addEventListener('input', () => {
    const volume = Math.min(1, Math.max(0, Number(volumeBar.value) / 100));
    applySoundState(volume, volume === 0);
  });
  volumeBar.addEventListener('change', showControls);

  for (const button of skipButtons) {
    button.addEventListener('click', () => skip(Number(button.dataset.skipSeconds)));
  }

  player.addEventListener('pointerdown', (event) => {
    if (isInteractive(event.target)) return;
    pointerStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    if (event.pointerType === 'mouse') showControls();
  });

  player.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'mouse') showControls();
  });

  player.addEventListener('pointerup', (event) => {
    if (!pointerStart || pointerStart.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pointerStart.x;
    const deltaY = event.clientY - pointerStart.y;
    pointerStart = null;
    if (
      player.classList.contains('is-orientation-seeking')
      || Math.abs(deltaX) >= TAP_THRESHOLD_PX
      || Math.abs(deltaY) >= TAP_THRESHOLD_PX
    ) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    handleTap(event);
  });

  player.addEventListener('pointercancel', (event) => {
    if (pointerStart?.pointerId === event.pointerId) pointerStart = null;
  });

  document.addEventListener('fullscreenchange', () => {
    updateFullscreenButton();
    if (!document.fullscreenElement && !isInstalledDisplayMode()) lastOrientationLock = null;
    else void lockToActiveVideo();
  });

  for (const video of videos) {
    for (const eventName of ['loadedmetadata', 'durationchange', 'timeupdate', 'progress', 'emptied']) {
      video.addEventListener(eventName, updateTimeline);
    }
    for (const eventName of ['play', 'playing', 'pause', 'ended']) {
      video.addEventListener(eventName, () => {
        if (video === activeVideo()) updatePlayState();
      });
    }
    video.addEventListener('loadedmetadata', () => {
      if (video === activeVideo()) void lockToActiveVideo();
    });
    video.addEventListener('playing', () => {
      if (video === activeVideo()) {
        updateTimeline();
        void lockToActiveVideo();
      }
    });
    video.addEventListener('volumechange', () => {
      if (syncingVolume || video !== activeVideo()) return;
      syncingVolume = true;
      for (const other of videos) {
        if (other === video) continue;
        other.volume = video.volume;
        other.muted = video.muted;
      }
      syncingVolume = false;
      updateVolumeUI();
    });
  }

  const observer = new MutationObserver(() => {
    updateTimeline();
    updatePlayState();
    updateVolumeUI();
    void lockToActiveVideo();
  });
  for (const video of videos) observer.observe(video, { attributes: true, attributeFilter: ['class'] });

  window.addEventListener('keydown', handleKeyboard);
  window.addEventListener('blur', clearHideTimer);

  const storedVolume = readStoredVolume();
  const restoreSound = readStoredSoundEnabled() && Boolean(navigator.userActivation?.hasBeenActive);
  syncingVolume = true;
  for (const video of videos) {
    video.volume = storedVolume;
    video.muted = !restoreSound || storedVolume === 0;
  }
  syncingVolume = false;

  setControlsVisible(true);
  updateTimeline();
  updatePlayState();
  updateVolumeUI();
  updateFullscreenButton();
}

if (typeof document !== 'undefined') initialize();
