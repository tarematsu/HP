LR"JS(

  // Survey discovery is relatively expensive and page-wide by necessity. Only
  // do it when playback is absent/paused; healthy playing content never scans
  // unrelated page dialogs.
  if (!video || video.paused) {
    const surveyRoots = Array.from(document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [data-testid*="survey" i], '
        + '[class*="survey" i], [class*="questionnaire" i]'));
    for (const root of surveyRoots) {
      if (!/(?:アンケート|ご回答|回答する|誕生年|誕生月|性別)/.test(
          normalize(root.textContent))) continue;
      const candidates = root.querySelectorAll(
          'button, [role="button"], a, [aria-label], [title]');
      for (const element of candidates) {
        if (!visible(element)) continue;
        if (/(?:閉じる|とじる|close|dismiss)/i.test(labelOf(element))) {
          return point(element);
        }
      }
    }
  }

  if (!video) return null;

  try {
    if (video.muted) video.muted = false;
    if (video.volume !== 1.0) video.volume = 1.0;
  } catch (_) {}

  let cachedPlayerControls = null;
  const playerControls = () => {
    if (cachedPlayerControls) return cachedPlayerControls;
    const root = playerRootFor(video);
    cachedPlayerControls = root ? Array.from(root.querySelectorAll(
        'button, [role="button"], a, [aria-label], [title]')) : [];
    return cachedPlayerControls;
  };

  if (video.paused && !video.ended) {
    // Playback recovery must be idempotent. A video-surface click is a play/pause
    // toggle, so a delayed trusted click can pause TVer after playback has already
    // started. Calling play() again on an already-playing media element is safe.
    try {
      const pending = video.play();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_) {}
    return null;
  }

  const browserFullscreen = document.fullscreenElement ||
      document.webkitFullscreenElement || document.msFullscreenElement;
  if (browserFullscreen) {
    if (state) state.fullscreenDirty = false;
    return null;
  }
  // fullscreenDirty=false means the one allowed fullscreen request for this
  // video has already been issued. Never re-enter fullscreen in the same item.
  if (state && state.fullscreenDirty === false) return null;

  const controls = playerControls();
  const exitFullscreenControl = controls.some(element => {
    if (!visible(element)) return false;
    const label = labelOf(element).toLowerCase();
    return /全画面を終了|全画面解除|フルスクリーンを終了/.test(label) ||
           label.includes('exit fullscreen');
  });
  if (exitFullscreenControl) {
    if (state) state.fullscreenDirty = false;
    return null;
  }
  const fullscreenButton = controls.find(element => {
    if (!visible(element)) return false;
    const label = labelOf(element).toLowerCase();
    if (/終了|解除/.test(label) || label.includes('exit fullscreen')) return false;
    return /全画面|フルスクリーン/.test(label) || label.includes('fullscreen');
  });
  // Consume the one-shot flag when the real control is available, before the
  // trusted click is dispatched. A failed click is not retried for this video.
  if (fullscreenButton && state) state.fullscreenDirty = false;
  return fullscreenButton ? point(fullscreenButton) : null;
})()
)JS"