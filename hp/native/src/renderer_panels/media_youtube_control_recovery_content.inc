LR"JS(

  const recoveryState = window.__homePanelYoutubeRecoveryState ||
      (window.__homePanelYoutubeRecoveryState = {
        videoKey: '', qualityApplied: false, captionsApplied: false,
        fullscreenApplied: false, fullscreenReadyAt: Date.now() + fullscreenSettleMs,
        pausedSince: 0, playRetryAttempted: false,
        lastCurrentTime: -1, lastProgressAt: Date.now(), nextRequestedAt: 0
      });
  let videoKey = '';
  let playlistId = '';
  try {
    const currentUrl = new URL(location.href);
    videoKey = currentUrl.searchParams.get('v') || '';
    playlistId = currentUrl.searchParams.get('list') || '';
  } catch (_) {}
  if (!videoKey && video) videoKey = video.currentSrc || video.src || '';
  if (recoveryState.videoKey !== videoKey) {
    recoveryState.videoKey = videoKey;
    recoveryState.qualityApplied = false;
    recoveryState.captionsApplied = false;
    recoveryState.fullscreenApplied = false;
    recoveryState.fullscreenReadyAt = Date.now() + fullscreenSettleMs;
    recoveryState.pausedSince = 0;
    recoveryState.playRetryAttempted = false;
    recoveryState.lastCurrentTime = -1;
    recoveryState.lastProgressAt = Date.now();
    recoveryState.nextRequestedAt = 0;
  }

  const now = Date.now();
  const pauseEscalationMs = 10 * 1000;
  const stallEscalationMs = 30 * 1000;
  const currentTime = Number(video?.currentTime);
  if (Number.isFinite(currentTime)) {
    const previousTime = Number(recoveryState.lastCurrentTime);
    if (previousTime < 0 || currentTime > previousTime + 0.25 ||
        currentTime + 2 < previousTime) {
      recoveryState.lastProgressAt = now;
      recoveryState.nextRequestedAt = 0;
    }
    recoveryState.lastCurrentTime = currentTime;
  }

  const advanceToNextPlaylistItem = () => {
    if (now - Number(recoveryState.nextRequestedAt || 0) < 8000) {
      return 'recovery';
    }

    // Prefer the playlist's concrete next watch URL. This avoids depending on
    // YouTube's autoplay state when playback has become stuck.
    const nextLink = player.querySelector('.ytp-next-button[href]');
    try {
      const candidate = new URL(
          nextLink?.getAttribute?.('href') || nextLink?.href || '', location.href);
      if ((candidate.hostname === 'www.youtube.com' ||
           candidate.hostname === 'youtube.com') &&
          candidate.pathname === '/watch' &&
          candidate.searchParams.get('v') &&
          candidate.searchParams.get('list') === playlistId &&
          candidate.href !== location.href) {
        recoveryState.nextRequestedAt = now;
        location.assign(candidate.href);
        return 'recovery';
      }
    } catch (_) {}

    // YouTube can temporarily omit the next anchor while retaining the player
    // API/control. Keep both as narrow fallbacks before restarting the playlist.
    try {
      if (typeof player.nextVideo === 'function') {
        recoveryState.nextRequestedAt = now;
        player.nextVideo();
        return 'recovery';
      }
    } catch (_) {}
    const nextControl = player.querySelector('.ytp-next-button');
    if (trusted.valid(nextControl)) {
      const action = trusted.arm(nextControl, 'next', 3000);
      if (action) {
        recoveryState.nextRequestedAt = now;
        return action;
      }
    }
    return 'reload';
  };

  if (video?.ended) return advanceToNextPlaylistItem();

  if (video && video.paused && !video.ended) {
    if (!recoveryState.pausedSince) recoveryState.pausedSince = now;
    if (!recoveryState.playRetryAttempted) {
      recoveryState.playRetryAttempted = true;
      try {
        const pending = video.play();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      } catch (_) {}
      const play = player.querySelector('.ytp-play-button');
      if (trusted.valid(play)) return trusted.arm(play, 'play', 1500);
      return 'recovery';
    }
    if (now - Number(recoveryState.pausedSince || now) >= pauseEscalationMs) {
      return advanceToNextPlaylistItem();
    }
    return 'recovery';
  }

  if (video) {
    recoveryState.pausedSince = 0;
    recoveryState.playRetryAttempted = false;
    if (now - Number(recoveryState.lastProgressAt || now) >= stallEscalationMs) {
      return advanceToNextPlaylistItem();
    }
  }

  // 480p is a per-content preference. Set it once for a new video. The page is
  // responsible for maintaining it afterwards; watchdog passes do not query or
  // reapply quality after the initial request succeeds.
  const preferredQuality = 'large';
  if (!recoveryState.qualityApplied) {
    let touched = false;
    try {
      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(preferredQuality, preferredQuality);
        touched = true;
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(preferredQuality);
        touched = true;
      }
    } catch (_) {}
    recoveryState.qualityApplied = touched;
  }

  // Captions follow the same per-video one-shot rule.
  if (!recoveryState.captionsApplied) {
    const captions = player.querySelector('.ytp-subtitles-button');
    if (captions && captions.getAttribute('aria-pressed') === 'true') {
      try {
        captions.click();
        recoveryState.captionsApplied = true;
      } catch (_) {}
    } else {
      try {
        if (typeof player.setOption === 'function') {
          player.setOption('captions', 'track', {});
          recoveryState.captionsApplied = true;
        }
      } catch (_) {}
    }
  }

  // Fullscreen remains a one-shot preference after YouTube confirms entry, but
  // merely arming a trusted click is not success. The control can appear before
  // YouTube is ready to accept fullscreen, so suppress the initial click for
  // 1.5 seconds and let the existing recovery watchdog make the first attempt
  // after the player has settled. No extra timer or polling loop is introduced.
  if (trusted.fullscreen()) {
    recoveryState.fullscreenApplied = true;
    return null;
  }
  if (recoveryState.fullscreenApplied) return null;
  if (Date.now() < Number(recoveryState.fullscreenReadyAt || 0)) {
    return 'recovery';
  }
  target = player.querySelector('.ytp-fullscreen-button');
  if (!trusted.valid(target)) {
    const fullscreenPattern = /(全画面|fullscreen|full screen)/i;
    target = Array.from(player.querySelectorAll(
        'button, [role="button"], [aria-label], [title]'))
        .find(element => trusted.valid(element) &&
            fullscreenPattern.test(trusted.text(element))) || null;
  }
  return trusted.arm(target, 'fullscreen', 1200);
})()
)JS"