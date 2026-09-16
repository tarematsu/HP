LR"JS(

  if (video && state && !state.lowQualitySet && !state.qualityAttemptExhausted) {
    const root = playerRootFor(video);
    if (root) {
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

      const qualityControls = Array.from(root.querySelectorAll(
          'button, [role="button"], [role="menuitem"], [role="radio"], '
          + '[role="option"], li, [aria-label], [title]')).filter(visible);
      const qualityName = element => labelOf(element)
          .replace(/[（(](?:選択中|設定中)[）)]/g, '')
          .replace(/画質$/, '').trim();
      const lowOption = qualityControls.find(element => qualityName(element) === '低') || null;
      const lowSelected = lowOption && (
          lowOption.getAttribute('aria-checked') === 'true' ||
          lowOption.getAttribute('aria-selected') === 'true' ||
          lowOption.getAttribute('data-state') === 'checked' ||
          /選択中|設定中/.test(labelOf(lowOption)));
      const useQualityAction = () => {
        const count = Number(state.qualityActionCount || 0);
        if (count >= 6) {
          state.qualityAttemptExhausted = true;
          return false;
        }
        state.qualityActionCount = count + 1;
        return true;
      };

      if (lowSelected) {
        state.lowQualitySet = true;
        state.lowClickPending = false;
      } else if (lowOption) {
        if (useQualityAction()) {
          state.lowClickPending = true;
          return point(lowOption);
        }
      } else if (state.lowClickPending) {
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
        if (target && useQualityAction()) return point(target);
      }
    }
  }

  if (!video || video.paused) {
    const surveyRoots = Array.from(document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [data-testid*="survey" i], '
        + '[class*="survey" i], [class*="questionnaire" i]'));
    for (const root of surveyRoots) {
      if (!/(?:アンケート|ご回答|回答する|誕生年|誕生月|性別)/.test(
          normalize(root.textContent))) continue;
      for (const element of root.querySelectorAll(
          'button, [role="button"], a, [aria-label], [title]')) {
        if (visible(element) && /(?:閉じる|とじる|close|dismiss)/i.test(labelOf(element))) {
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

  const resumeVideo = () => {
    try {
      const pending = video.play();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_) {}
  };

  if (state && state.recoveryPending && !video.ended) {
    const recoveryAge = Date.now() - Number(state.recoverySince || Date.now());
    if (recoveryAge >= 30 * 1000) return 'restart';
    resumeVideo();
    try { state.requestRecoveryWake?.('pending-watchdog'); } catch (_) {}
    return null;
  }

  if (video.paused && !video.ended) {
    resumeVideo();
    try { state?.requestRecoveryWake?.('paused-watchdog'); } catch (_) {}
    return null;
  }

  if (hasVisibleLoginPrompt()) return null;
  return null;
})()
)JS"