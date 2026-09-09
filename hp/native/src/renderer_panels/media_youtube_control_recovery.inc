// Reliable YouTube control recovery for hidden player chrome. The native host
// dispatches the returned point through CDP trusted input. Core playback actions
// are armed behind a short-lived full-viewport target so layout movement between
// DOM discovery and the trusted click cannot accidentally hit the video surface.
namespace {
constexpr wchar_t kNativeMediaYoutubeControlRecoveryScript[] = LR"JS(
(() => {
  const player = document.querySelector('#movie_player');
  if (!player || window.innerWidth <= 0 || window.innerHeight <= 0) return null;

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const textOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.textContent
  ].filter(Boolean).join(' '));
  const usableRect = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return null;
    const style = getComputedStyle(element);
    if (style.display === 'none') return null;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  };
  const prepareTrustedTarget = element => {
    if (!usableRect(element)) return null;
    // YouTube autohide and HomePanel's clean-player CSS can leave the correct
    // control transparent or pointer-blocked. Keep it visually hidden, but make
    // only the ancestor hit-test path usable for the following trusted CDP click.
    for (let node = element; node && node !== player.parentElement;
         node = node.parentElement) {
      if (node.style) {
        node.style.setProperty('pointer-events', 'auto', 'important');
        if (getComputedStyle(node).visibility === 'hidden') {
          node.style.setProperty('visibility', 'visible', 'important');
        }
      }
      if (node === player) break;
    }
    return element;
  };
  const actionState = () => window.__homePanelYoutubeTrustedActionState ||
      (window.__homePanelYoutubeTrustedActionState = { action: '', at: 0 });
  const reserveAction = (action, cooldownMs) => {
    const state = actionState();
    const now = Date.now();
    if (state.action === action && now - Number(state.at || 0) < cooldownMs) {
      return false;
    }
    state.action = action;
    state.at = now;
    return true;
  };
  const guardedPoint = (element, action, cooldownMs) => {
    element = prepareTrustedTarget(element);
    const rect = usableRect(element);
    if (!rect || !reserveAction(action, cooldownMs)) return null;
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };
  const isAdShowing = () => player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');
  const isFullscreen = () => Boolean(
      document.fullscreenElement || document.webkitFullscreenElement ||
      player.classList.contains('ytp-fullscreen'));

  // Core actions use a stable trusted-click landing surface. YouTube can move or
  // hide its chrome in the few milliseconds between ExecuteScript completion and
  // CDP Input.dispatchMouseEvent; clicking the old coordinates then toggles the
  // video itself, which looks like "Skip" becoming Pause. The landing surface
  // absorbs that real click and invokes only the already-validated action while
  // the browser still has transient user activation.
  const armTrustedAction = (element, action, cooldownMs) => {
    element = prepareTrustedTarget(element);
    if (!usableRect(element) || !reserveAction(action, cooldownMs)) return null;

    const id = '__homePanelYoutubeTrustedActionTarget';
    document.getElementById(id)?.remove();
    const landing = document.createElement('button');
    landing.id = id;
    landing.type = 'button';
    landing.tabIndex = -1;
    landing.setAttribute('aria-hidden', 'true');
    landing.style.cssText = [
      'position:fixed', 'inset:0', 'width:100vw', 'height:100vh',
      'margin:0', 'padding:0', 'border:0', 'opacity:0',
      'background:transparent', 'pointer-events:auto',
      'z-index:2147483647'
    ].join(';');

    const target = element;
    landing.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      landing.remove();
      try {
        if (!target.isConnected || !usableRect(target)) return;
        if (action === 'skip-ad') {
          if (!isAdShowing()) return;
          target.click();
          return;
        }
        if (isAdShowing()) return;
        if (action === 'play') {
          const video = player.querySelector('video');
          if (!video || video.ended || !video.paused) return;
          target.click();
          return;
        }
        if (action === 'fullscreen') {
          if (isFullscreen()) return;
          target.click();
        }
      } catch (_) {}
    }, { once: true, capture: true });
    (document.body || document.documentElement).appendChild(landing);
    setTimeout(() => {
      if (landing.isConnected) landing.remove();
    }, 1400);
    return [5000, 5000];
  };

  // Survey handling remains first because it can cover the ad skip surface.
  const submitPattern = /^(送信|回答を送信|submit|send)$/i;
  const surveyRoots = Array.from(document.querySelectorAll(
      '.ytp-ad-survey, .ytp-ad-feedback-dialog, yt-survey-renderer, '
      + 'ytd-survey-renderer, tp-yt-paper-dialog, [role="dialog"]'))
      .filter(element => usableRect(element));
  for (const root of surveyRoots) {
    const controls = Array.from(root.querySelectorAll(
        'button, tp-yt-paper-button, [role="button"], [role="radio"]'));
    const submit = controls.find(element =>
        usableRect(element) && submitPattern.test(textOf(element)));
    if (!submit) continue;
    const options = controls.filter(element => {
      if (element === submit || !usableRect(element)) return false;
      const text = textOf(element);
      return text && !submitPattern.test(text) &&
          !/^(閉じる|キャンセル|cancel|close|skip|スキップ)$/i.test(text);
    });
    if (!options.length) continue;
    const state = window.__homePanelYoutubeSurveyState ||
        (window.__homePanelYoutubeSurveyState = { step: 0, at: 0 });
    if (Date.now() - Number(state.at || 0) > 8000) state.step = 0;
    state.at = Date.now();
    if (state.step === 0) {
      state.step = 1;
      return guardedPoint(options[0], 'survey-option', 500);
    }
    state.step = 0;
    return guardedPoint(submit, 'survey-submit', 500);
  }

  const adShowing = isAdShowing();
  const skipSelectors = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.videoAdUiSkipButton',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-slot [role="button"]',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-skip-button-container [role="button"]',
    'button[class*="ytp-ad-skip"]',
    '[class*="ytp-ad-skip"][role="button"]',
    'button[aria-label*="Skip ad" i]',
    'button[aria-label*="Skip ads" i]',
    'button[aria-label*="広告をスキップ"]',
    'button[aria-label*="広告を飛ばす"]',
    '[role="button"][aria-label*="Skip ad" i]',
    '[role="button"][aria-label*="広告をスキップ"]'
  ];
  let target = Array.from(player.querySelectorAll(skipSelectors.join(',')))
      .find(element => usableRect(element)) || null;
  if (!target && adShowing) {
    const skipPattern = /(広告をスキップ|広告を飛ばす|(?:^|\s)スキップ(?:\s|$)|skip\s*ad(?:s)?)/i;
    target = Array.from(player.querySelectorAll(
        'button, tp-yt-paper-button, [role="button"]'))
        .find(element => usableRect(element) && skipPattern.test(textOf(element))) || null;
  }
  if (adShowing && target) return armTrustedAction(target, 'skip-ad', 600);

  // Do not toggle captions, play state or fullscreen during an unskippable ad.
  if (adShowing) return null;

  const captionsButton = player.querySelector('.ytp-subtitles-button');
  if (captionsButton && captionsButton.getAttribute('aria-pressed') === 'true') {
    try { captionsButton.click(); } catch (_) {}
  } else {
    try {
      if (typeof player.setOption === 'function') player.setOption('captions', 'track', {});
    } catch (_) {}
  }

  const video = player.querySelector('video');
  if (video && video.paused && !video.ended) {
    try {
      const pending = video.play();
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch (_) {}
    const playButton = player.querySelector('.ytp-play-button');
    if (usableRect(playButton)) return armTrustedAction(playButton, 'play', 1500);
  }

  if (isFullscreen()) return null;

  // Prefer the canonical button, then semantic labels used by YouTube layout
  // experiments. The actual trusted click lands on the fixed action surface
  // above, so transparent/autohidden chrome cannot shift the click onto video.
  target = player.querySelector('.ytp-fullscreen-button');
  if (!usableRect(target)) {
    const fullscreenPattern = /(全画面|fullscreen|full screen)/i;
    target = Array.from(player.querySelectorAll(
        'button, [role="button"], [aria-label], [title]'))
        .find(element => usableRect(element) && fullscreenPattern.test(textOf(element))) || null;
  }
  return armTrustedAction(target, 'fullscreen', 1200);
})()
)JS";
}  // namespace
