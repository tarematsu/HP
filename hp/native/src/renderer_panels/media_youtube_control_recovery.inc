// Reliable YouTube control recovery for hidden player chrome. The native host
// dispatches the returned point through CDP trusted input, so this policy only
// discovers the intended control and makes its hit-test path usable.
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
  const guardedPoint = (element, action, cooldownMs) => {
    element = prepareTrustedTarget(element);
    const rect = usableRect(element);
    if (!rect) return null;
    const now = Date.now();
    const state = window.__homePanelYoutubeTrustedActionState ||
        (window.__homePanelYoutubeTrustedActionState = { action: '', at: 0 });
    if (state.action === action && now - Number(state.at || 0) < cooldownMs) {
      return null;
    }
    state.action = action;
    state.at = now;
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
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

  const adShowing = player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting');
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
    '[aria-label*="Skip ad" i]',
    '[aria-label*="Skip ads" i]',
    '[aria-label*="広告をスキップ"]',
    '[aria-label*="広告を飛ばす"]'
  ];
  let target = Array.from(player.querySelectorAll(skipSelectors.join(',')))
      .find(element => usableRect(element)) || null;
  if (!target && adShowing) {
    const skipPattern = /(広告をスキップ|広告を飛ばす|(?:^|\s)スキップ(?:\s|$)|skip\s*ad(?:s)?)/i;
    target = Array.from(player.querySelectorAll(
        'button, tp-yt-paper-button, [role="button"], [class*="skip" i]'))
        .find(element => usableRect(element) && skipPattern.test(textOf(element))) || null;
  }
  if (target) return guardedPoint(target, 'skip-ad', 600);

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
    if (usableRect(playButton)) return guardedPoint(playButton, 'play', 1500);
  }

  const fullscreen = document.fullscreenElement || document.webkitFullscreenElement ||
      player.classList.contains('ytp-fullscreen');
  if (fullscreen) return null;

  // Prefer the canonical button, then semantic labels used by YouTube layout
  // experiments. Unlike ordinary controls, transparent/pointer-blocked chrome is
  // still a valid trusted target and is prepared above before the CDP click.
  target = player.querySelector('.ytp-fullscreen-button');
  if (!usableRect(target)) {
    const fullscreenPattern = /(全画面|fullscreen|full screen)/i;
    target = Array.from(player.querySelectorAll(
        'button, [role="button"], [aria-label], [title]'))
        .find(element => usableRect(element) && fullscreenPattern.test(textOf(element))) || null;
  }
  return guardedPoint(target, 'fullscreen', 1200);
})()
)JS";
}  // namespace
