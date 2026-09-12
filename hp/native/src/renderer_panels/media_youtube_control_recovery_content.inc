LR"JS(

  const recoveryState = window.__homePanelYoutubeRecoveryState ||
      (window.__homePanelYoutubeRecoveryState = {
        videoKey: '', qualityApplied: false, captionsApplied: false,
        fullscreenApplied: false
      });
  let videoKey = '';
  try {
    videoKey = new URL(location.href).searchParams.get('v') || '';
  } catch (_) {}
  if (!videoKey && video) videoKey = video.currentSrc || video.src || '';
  if (recoveryState.videoKey !== videoKey) {
    recoveryState.videoKey = videoKey;
    recoveryState.qualityApplied = false;
    recoveryState.captionsApplied = false;
    recoveryState.fullscreenApplied = false;
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

  if (video && video.paused && !video.ended) {
    try {
      const pending = video.play();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_) {}
    const play = player.querySelector('.ytp-play-button');
    if (trusted.valid(play)) return trusted.arm(play, 'play', 1500);
    return 'recovery';
  }

  // Fullscreen remains a one-shot preference after YouTube confirms entry, but
  // merely arming a trusted click is not success. The initial control can exist
  // before YouTube is ready to accept the click, so leave fullscreenApplied
  // false until the page actually reports fullscreen and let the 2-second
  // recovery watchdog retry the real control when the first click is ignored.
  if (trusted.fullscreen()) {
    recoveryState.fullscreenApplied = true;
    return null;
  }
  if (recoveryState.fullscreenApplied) return null;
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