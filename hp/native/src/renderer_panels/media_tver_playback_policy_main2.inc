LR"JS(

  // Low-quality selection is a bounded, event-driven trusted-click sequence.
  // The page-local MutationObserver wakes this watchdog when Settings/Quality
  // menus appear, so no fixed 2-second quality poll is required.
  if (video && state && !state.lowQualitySet &&
      !state.qualityAttemptExhausted) {
    const qualityRoot = playerRootFor(video);
    if (qualityRoot) {
      try {
        const rect = visibleRect(video);
        if (rect) {
          video.dispatchEvent(new MouseEvent('mousemove', {
            bubbles: true,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          }));
        }
      } catch (_) {}

      const qualityControls = Array.from(qualityRoot.querySelectorAll(
          'button, [role="button"], [role="menuitem"], [role="radio"], '
          + '[role="option"], li, [aria-label], [title]'))
          .filter(visible);
      const qualityName = element => labelOf(element)
          .replace(/[（(](?:選択中|設定中)[）)]/g, '')
          .replace(/画質$/, '')
          .trim();
      const qualityChoices = qualityControls.filter(element =>
          /^(自動|高|中|低)$/.test(qualityName(element)));
      const lowOption = qualityChoices.find(element =>
          qualityName(element) === '低') || null;
      const lowSelected = lowOption && (
          lowOption.getAttribute('aria-checked') === 'true' ||
          lowOption.getAttribute('aria-selected') === 'true' ||
          lowOption.getAttribute('data-state') === 'checked' ||
          /選択中|設定中/.test(labelOf(lowOption)));

      if (lowSelected) {
        state.lowQualitySet = true;
        state.lowClickPending = false;
      } else if (lowOption) {
        if (Number(state.qualityActionCount || 0) >= 6) {
          state.qualityAttemptExhausted = true;
        } else {
          state.lowClickPending = true;
          state.qualityActionCount = Number(state.qualityActionCount || 0) + 1;
          return point(lowOption);
        }
      } else if (state.lowClickPending) {
        // Selecting Low normally closes the menu. Once the trusted click has
        // been issued and the option disappears, treat that transition as the
        // completion signal and stop all quality work for this media item.
        state.lowQualitySet = true;
        state.lowClickPending = false;
      } else {
        const qualityMenu = qualityControls.find(element => {
          const label = labelOf(element).toLowerCase();
          return label === '画質' || label === '画質設定' ||
                 label === 'quality' || label === 'quality settings';
        }) || null;
        const settings = qualityControls.find(element => {
          const label = labelOf(element).toLowerCase();
          return label === '設定' || label.includes('プレイヤー設定') ||
                 label === 'settings' || label === 'setting';
        }) || null;
        const target = qualityMenu || settings;
        if (target) {
          if (Number(state.qualityActionCount || 0) >= 6) {
            state.qualityAttemptExhausted = true;
          } else {
            state.qualityActionCount = Number(state.qualityActionCount || 0) + 1;
            return point(target);
          }
        }
      }
    }
  }

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

  if (state && state.recoveryPending && !video.ended) {
    const recoveryAge = Date.now() - Number(state.recoverySince || Date.now());
    if (recoveryAge >= 30 * 1000) return 'restart';
    try {
      const pending = video.play();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_) {}
    try { state.requestRecoveryWake?.('pending-watchdog'); } catch (_) {}
    return null;
  }

  if (video.paused && !video.ended) {
    // Playback recovery must be idempotent. A video-surface click is a play/pause
    // toggle, so a delayed trusted click can pause TVer after playback has already
    // started. Calling play() again on an already-playing media element is safe.
    try {
      const pending = video.play();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_) {}
    try { state?.requestRecoveryWake?.('paused-watchdog'); } catch (_) {}
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