// YouTube playback policy kept outside the large media host implementation so
// survey handling, ad skipping and quality selection stay independently testable.
namespace {
constexpr wchar_t kNativeMediaYoutubeWatchdogPolicyScript[] = LR"JS(
(() => {
  const player = document.querySelector('#movie_player');
  if (!player || window.innerWidth <= 0 || window.innerHeight <= 0) return null;

  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const isClickable = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const point = element => {
    if (!isClickable(element)) return null;
    const rect = element.getBoundingClientRect();
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };
  const textOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('title'),
    element?.textContent
  ].filter(Boolean).join(' '));

  // YouTube occasionally shows a five-choice survey over the player. Drive it
  // as two trusted clicks across watchdog passes: first option, then Submit.
  const submitPattern = /^(送信|回答を送信|submit|send)$/i;
  const surveyRoots = Array.from(document.querySelectorAll(
      '.ytp-ad-survey, .ytp-ad-feedback-dialog, yt-survey-renderer, '
      + 'ytd-survey-renderer, tp-yt-paper-dialog, [role="dialog"]'))
      .filter(isClickable);
  for (const root of surveyRoots) {
    const submit = Array.from(root.querySelectorAll(
        'button, tp-yt-paper-button, [role="button"]'))
        .find(element => isClickable(element) &&
            submitPattern.test(textOf(element).toLowerCase()));
    if (!submit) continue;

    let options = Array.from(root.querySelectorAll(
        '.ytp-ad-survey-answer-button, [role="radio"], '
        + 'tp-yt-paper-radio-button, input[type="radio"]'))
        .filter(isClickable);
    if (options.length < 5) {
      options = Array.from(root.querySelectorAll(
          'button, tp-yt-paper-button, [role="button"]'))
          .filter(element => {
            if (!isClickable(element) || element === submit) return false;
            const text = textOf(element).toLowerCase();
            return text && !submitPattern.test(text) &&
                   !/^(閉じる|キャンセル|cancel|close|skip|スキップ)$/i.test(text);
          });
    }
    if (options.length < 5) continue;

    const surveyKey = normalize(root.textContent).slice(0, 180);
    const now = Date.now();
    const state = window.__homePanelYoutubeSurveyState ||
        (window.__homePanelYoutubeSurveyState = { key: '', step: 0, at: 0 });
    if (state.key !== surveyKey || now - state.at > 8000) {
      state.key = surveyKey;
      state.step = 0;
    }
    state.at = now;
    if (state.step === 0) {
      state.step = 1;
      return point(options[0]);
    }
    state.step = 0;
    return point(submit);
  }

  const captionsButton = player.querySelector('.ytp-subtitles-button');
  if (captionsButton && captionsButton.getAttribute('aria-pressed') === 'true') {
    try { captionsButton.click(); } catch (_) {}
  } else {
    try {
      if (typeof player.setOption === 'function') {
        player.setOption('captions', 'track', {});
      }
    } catch (_) {}
  }

  // Prefer explicit selectors, then fall back to visible text because YouTube
  // regularly changes the skip button's class name while keeping its label.
  const selectors = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.videoAdUiSkipButton',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button',
    'button[class*="ytp-ad-skip"]'
  ];
  let target = Array.from(document.querySelectorAll(selectors.join(',')))
      .find(isClickable) || null;
  if (!target) {
    const skipPattern = /(広告をスキップ|広告を飛ばす|skip ad|skip ads)/i;
    target = Array.from(player.querySelectorAll(
        'button, tp-yt-paper-button, [role="button"]'))
        .find(element => isClickable(element) && skipPattern.test(textOf(element))) ||
        null;
  }
  if (target) return point(target);

  const fullscreen = document.fullscreenElement ||
      player.classList.contains('ytp-fullscreen');
  if (fullscreen) return null;
  target = player.querySelector('.ytp-fullscreen-button');
  return point(target);
})()
)JS";

constexpr wchar_t kNativeMediaYoutubeHealthPolicyScript[] = LR"JS(
(() => {
  const player = document.querySelector('#movie_player');
  if (player) {
    try {
      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange('hd720', 'hd720');
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality('hd720');
      }
      if (typeof player.getAvailableQualityLevels === 'function') {
        const levels = player.getAvailableQualityLevels() || [];
        if (levels.includes('hd720') &&
            typeof player.getPlaybackQuality === 'function' &&
            player.getPlaybackQuality() !== 'hd720' &&
            typeof player.setPlaybackQuality === 'function') {
          player.setPlaybackQuality('hd720');
        }
      }
    } catch (_) {}
  }
  const video = document.querySelector('video');
  if (video && video.error) return true;
  if (player && player.classList.contains('ytp-error')) return true;
  const error = document.querySelector(
      '.ytp-error, .ytp-error-content-wrap, .ytp-error-content, '
      + 'yt-player-error-message-renderer, ytd-player-error-message-renderer');
  if (!error) return false;
  const style = window.getComputedStyle(error);
  const rect = error.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' &&
         rect.width > 0 && rect.height > 0;
})()
)JS";
}  // namespace
